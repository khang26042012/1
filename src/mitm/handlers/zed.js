const { err } = require("../logger");
const { fetchRouter, pipeSSE } = require("./base");

/**
 * Zed Hosted AI MITM handler.
 *
 * Intercepts POST cloud.zed.dev/completions, unwraps the CompletionBody envelope
 * ({ provider, model, provider_request }), forwards the inner provider_request
 * to ExtremeRouter, and wraps the response back as Zed JSONL (Status/Event lines)
 * so the Zed Editor client can consume it natively.
 */

/**
 * Map a Zed cloud provider id to the ExtremeRouter path.
 * Anthropic-shaped provider_request → /v1/messages; everything else → /v1/chat/completions.
 */
function resolveRouterPath(provider) {
  const p = String(provider || "").toLowerCase();
  if (p === "anthropic") return "/v1/messages";
  return "/v1/chat/completions";
}

/**
 * Convert an ExtremeRouter SSE/JSON response into Zed JSONL Status/Event lines
 * and write them to the client response.
 */
async function pipeAsZedJsonl(routerRes, res) {
  const status = routerRes.status || 200;
  res.writeHead(status, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "x-zed-client-supports-status-messages": "true",
  });

  res.write(`${JSON.stringify({ Status: { Queued: { position: 0 } } })}\n`);
  res.write(`${JSON.stringify({ Status: "Started" })}\n`);

  if (!routerRes.ok) {
    const text = await routerRes.text().catch(() => "");
    let errObj;
    try {
      errObj = JSON.parse(text);
    } catch {
      errObj = { message: text || `HTTP ${status}` };
    }
    res.write(`${JSON.stringify({ Status: { Failed: errObj } })}\n`);
    res.write(`${JSON.stringify({ Status: "StreamEnded" })}\n`);
    res.end();
    return;
  }

  const ct = (routerRes.headers.get("content-type") || "").toLowerCase();

  // Non-stream JSON body.
  if (!ct.includes("text/event-stream") && !routerRes.body) {
    const text = await routerRes.text().catch(() => "");
    try {
      const parsed = JSON.parse(text);
      res.write(`${JSON.stringify({ Event: parsed })}\n`);
    } catch {
      if (text) res.write(`${JSON.stringify({ Event: { text } })}\n`);
    }
    res.write(`${JSON.stringify({ Status: "StreamEnded" })}\n`);
    res.end();
    return;
  }

  if (!routerRes.body) {
    res.write(`${JSON.stringify({ Status: "StreamEnded" })}\n`);
    res.end();
    return;
  }

  const reader = routerRes.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // OpenAI / Claude SSE: "data: {...}"
      if (trimmed.startsWith("data:")) {
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          res.write(`${JSON.stringify({ Event: parsed })}\n`);
        } catch {
          /* skip malformed */
        }
        continue;
      }

      // Already JSONL event.
      if (trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.Event !== undefined || parsed.Status !== undefined) {
            res.write(`${trimmed}\n`);
          } else {
            res.write(`${JSON.stringify({ Event: parsed })}\n`);
          }
        } catch {
          /* skip */
        }
      }
    }
  }

  res.write(`${JSON.stringify({ Status: "StreamEnded" })}\n`);
  res.end();
}

/**
 * Intercept Zed Hosted AI /completions — unwrap provider_request, remap model,
 * forward to ExtremeRouter, wrap response as Zed JSONL.
 */
async function intercept(req, res, bodyBuffer, mappedModel) {
  try {
    // Non-completion paths should never reach here (URL_PATTERNS guards), but be safe.
    if (!String(req.url || "").includes("/completions")) {
      if (!res.headersSent) res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Unsupported Zed MITM path", type: "mitm_error" } }));
      return;
    }

    const body = JSON.parse(bodyBuffer.toString());
    const provider = body.provider || "open_ai";
    const providerRequest = body.provider_request || body;

    // Remap model on envelope + nested request.
    body.model = mappedModel;
    if (providerRequest && typeof providerRequest === "object") {
      providerRequest.model = mappedModel;
      // Ensure streaming for chat-style clients.
      if (providerRequest.stream === undefined) providerRequest.stream = true;
    }

    const routerPath = resolveRouterPath(provider);
    const routerBody =
      provider === "anthropic"
        ? { ...providerRequest, model: mappedModel }
        : {
            ...providerRequest,
            model: mappedModel,
            // Hint for router if nested OpenAI body lacked stream.
            stream: providerRequest.stream !== false,
          };

    const routerRes = await fetchRouter(routerBody, routerPath, req.headers);

    // If router already returns Zed-like JSONL, pipe through; else wrap.
    const ct = (routerRes.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("ndjson") || ct.includes("jsonl")) {
      await pipeSSE(routerRes, res);
      return;
    }

    await pipeAsZedJsonl(routerRes, res);
  } catch (error) {
    err(`[zed] ${error.message}`);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/x-ndjson" });
    }
    try {
      res.write(`${JSON.stringify({ Status: { Failed: { message: error.message } } })}\n`);
      res.write(`${JSON.stringify({ Status: "StreamEnded" })}\n`);
    } catch {
      /* ignore */
    }
    res.end();
  }
}

module.exports = { intercept };
