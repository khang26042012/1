import { claudeToOpenAIRequest } from "../translator/request/claude-to-openai.js";
import { openaiToClaudeRequest } from "../translator/request/openai-to-claude.js";
import {
  openaiResponsesToOpenAIRequest,
  openaiToOpenAIResponsesRequest,
} from "../translator/request/openai-responses.js";

const DEFAULT_TIMEOUT_MS = 3000;

function jsonBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value) || "").length;
  } catch {
    return 0;
  }
}

function messagePayload(body) {
  if (Array.isArray(body?.messages)) return body.messages;
  if (Array.isArray(body?.input)) return body.input;
  return null;
}

// Trailing run of items after the last assistant/model turn = the current user
// turn (same semantics as combo.js trailingUserItems). History = everything
// before that run.
function trailingUserRun(items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const isAssistant = (r) => r === "assistant" || r === "model";
  let i = items.length - 1;
  while (i >= 0 && !isAssistant(items[i]?.role)) i--;
  return items.slice(i + 1);
}

// Byte snapshot with a size breakdown: whole body, message array, tool schema,
// tool_choice, system prompt, history (messages minus the current user turn)
// and the current turn itself. History/current-turn are measured as the SUM of
// per-item JSON — zero for empty, and free of array-serialization overhead
// ("[]" would otherwise count as 2 bytes of "nothing"). Exported for tests.
export function captureSizeSnapshot(body) {
  const messages = messagePayload(body);
  const currentTurn = trailingUserRun(messages);
  const sumBytes = (items) => (Array.isArray(items) ? items.reduce((acc, item) => acc + jsonBytes(item), 0) : 0);
  return {
    bodyBytes: jsonBytes(body),
    messageBytes: messages ? jsonBytes(messages) : 0,
    // Breakdown fields — tool schema/history repeated across calls dominate
    // outbound payloads; report them separately from the message text.
    toolsBytes: jsonBytes(body?.tools),
    toolChoiceBytes: jsonBytes(body?.tool_choice),
    systemBytes: jsonBytes(body?.system),
    historyBytes: messages ? sumBytes(messages.slice(0, messages.length - currentTurn.length)) : 0,
    currentTurnBytes: sumBytes(currentTurn),
  };
}

function setDiagnostic(diagnostics, reason) {
  if (diagnostics && !diagnostics.reason) diagnostics.reason = reason;
}

function scrubSensitiveUrlText(text) {
  return String(text)
    .replace(/\/\/[^/@\s]+@/g, "//")
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s)]*/g, "$1");
}

function describeFetchError(error) {
  const cause = error?.cause;
  const code = cause?.code || error?.code;
  const message = scrubSensitiveUrlText(cause?.message || error?.message || String(error));
  return code ? `${code}: ${message}` : message;
}

function buildCompressEndpoint(url) {
  try {
    const parsed = new URL(url);
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/v1/compress`;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    const raw = String(url).replace(/#.*$/, "");
    const [base, query = ""] = raw.split("?", 2);
    const endpoint = `${base.replace(/\/$/, "")}/v1/compress`;
    return query ? `${endpoint}?${query}` : endpoint;
  }
}

function maskEndpoint(endpoint) {
  try {
    const parsed = new URL(endpoint);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return String(endpoint).replace(/\/\/[^/@\s]+@/, "//").replace(/[?#].*$/, "");
  }
}

function hasUnsafeResponsesInputForCompression(body) {
  if (!Array.isArray(body?.input)) return false;
  return body.input.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    return typeof item.type === "string" && item.type !== "message";
  });
}

// POST messages to Headroom /v1/compress; returns compressed messages + stats or null.
async function callCompress(url, messages, model, timeoutMs, compressUserMessages, diagnostics) {
  const endpoint = buildCompressEndpoint(url);
  diagnostics.endpoint = maskEndpoint(endpoint);
  const payload = { messages, model };
  if (compressUserMessages) payload.config = { compress_user_messages: true };
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    setDiagnostic(diagnostics, `request failed: ${describeFetchError(error)}`);
    return null;
  }
  if (!res.ok) {
    setDiagnostic(diagnostics, `proxy returned HTTP ${res.status}`);
    return null;
  }
  const data = await res.json();
  if (!Array.isArray(data?.messages)) {
    setDiagnostic(diagnostics, "proxy response missing messages[]");
    return null;
  }
  return data;
}

// Compress request body via Headroom proxy. Fail-open: returns null on any error.
// /v1/compress only understands OpenAI shape, so Claude bodies are translated
// to OpenAI, compressed, then translated back using ExtremeRouter's own translators.
export async function compressWithHeadroom(body, { enabled, url, model, format, compressUserMessages, timeoutMs = DEFAULT_TIMEOUT_MS, diagnostics = null } = {}) {
  if (!enabled) {
    setDiagnostic(diagnostics, "disabled");
    return null;
  }
  if (!url) {
    setDiagnostic(diagnostics, "missing proxy URL");
    return null;
  }
  if (!body) {
    setDiagnostic(diagnostics, "missing request body");
    return null;
  }

  try {
    if (diagnostics) diagnostics.before = captureSizeSnapshot(body);

    // Claude shape: translate → OpenAI → compress → translate back.
    if (format === "claude") {
      const oai = claudeToOpenAIRequest(model, body, false);
      if (!Array.isArray(oai?.messages)) {
        setDiagnostic(diagnostics, "Claude request did not translate to messages[]");
        return null;
      }
      const data = await callCompress(url, oai.messages, model, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data) return null;
      const claudeBody = openaiToClaudeRequest(model, { ...oai, messages: data.messages }, false);
      if (Array.isArray(claudeBody?.messages)) body.messages = claudeBody.messages;
      if (claudeBody?.system !== undefined) body.system = claudeBody.system;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    // OpenAI Responses shape (Codex): body.input holds Responses items, NOT OpenAI
    // messages. Translate input -> OpenAI -> compress -> translate back to input so
    // body.input keeps the Responses contract (the proxy only understands OpenAI). (#1998)
    if (format === "openai-responses") {
      if (hasUnsafeResponsesInputForCompression(body)) {
        setDiagnostic(diagnostics, "skipped: openai-responses tool/reasoning input is not safe to compress");
        return null;
      }
      const oai = openaiResponsesToOpenAIRequest(model, body, false);
      if (!Array.isArray(oai?.messages)) return null;
      const data = await callCompress(url, oai.messages, model, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data) return null;
      // input: undefined so the translator rebuilds input from the compressed
      // messages instead of returning the original input unchanged.
      const responsesBody = openaiToOpenAIResponsesRequest(
        model,
        { ...oai, input: undefined, messages: data.messages },
        false
      );
      if (Array.isArray(responsesBody?.input)) body.input = responsesBody.input;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    // Kiro shape: conversationState holds history + currentMessage.
    // Flatten to OpenAI messages, compress, then rebuild conversationState.
    if (format === "kiro" && body?.conversationState) {
      const cs = body.conversationState;
      const history = cs.history || [];
      const messages = [];
      for (const turn of history) {
        if (turn.role === "user" && turn.userInputMessageContext?.toolResults) {
          // Flatten tool results into text
          for (const tr of turn.userInputMessageContext.toolResults) {
            if (tr.content?.text) messages.push({ role: "user", content: tr.content.text });
          }
        } else if (turn.role === "assistant" && turn.assistantResponse?.content) {
          for (const part of turn.assistantResponse.content) {
            if (part.text) messages.push({ role: "assistant", content: part.text });
          }
        }
      }
      // Add current message
      const currentText = cs.currentMessage?.userInputMessageContext?.inputMessage?.blocks
        ?.filter((b) => b.text?.content).map((b) => b.text.content).join("\n");
      if (currentText) messages.push({ role: "user", content: currentText });

      if (messages.length === 0) {
        setDiagnostic(diagnostics, "kiro conversationState yielded no messages");
        return null;
      }
      const data = await callCompress(url, messages, model, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data) return null;
      // Replace the largest text-heavy message in the current message with compressed version.
      const lastUserIdx = messages.length - 1;
      if (cs.currentMessage?.userInputMessageContext?.inputMessage?.blocks) {
        const blocks = cs.currentMessage.userInputMessageContext.inputMessage.blocks;
        const textBlock = blocks.find((b) => b.text?.content);
        if (textBlock?.text) textBlock.text.content = messages[lastUserIdx]?.content || textBlock.text.content;
      }
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    // OpenAI shape: messages/input go straight to the proxy.
    const key = Array.isArray(body.messages) ? "messages"
      : Array.isArray(body.input) ? "input"
      : null;
    if (!key) {
      setDiagnostic(diagnostics, `unsupported ${format || "unknown"} request shape`);
      return null;
    }
    const data = await callCompress(url, body[key], model, timeoutMs, compressUserMessages, diagnostics || {});
    if (!data) return null;
    body[key] = data.messages;
    if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
    return data;
  } catch (error) {
    setDiagnostic(diagnostics, `unexpected error: ${error?.message || String(error)}`);
    return null;
  }
}

export function formatHeadroomLog(stats) {
  if (!stats) return null;
  const before = stats.tokens_before || 0;
  const after = stats.tokens_after || 0;
  const delta = stats.tokens_saved || 0;
  const pct = before > 0 ? ((delta / before) * 100).toFixed(1) : "0";
  return `reported token delta=${delta} before=${before}${after ? ` after=${after}` : ""} (${pct}%)`.trim();
}

export function formatHeadroomSizeLog(diagnostics) {
  const before = diagnostics?.before;
  const after = diagnostics?.after;
  if (!before || !after) return "";
  return `body=${before.bodyBytes}B→${after.bodyBytes}B messages=${before.messageBytes}B→${after.messageBytes}B`;
}

// Effective payload savings: byte delta of the ACTUAL outbound JSON (body
// before vs after compression), independent of the proxy's reported token
// delta. Tool schema/history are broken out — they dominate payload size and
// are exactly what compression targets. Returns a human line or null when
// either snapshot is missing.
// Build the per-request byte sample for the Headroom effective payload savings
// dashboard card. Derived from the request-body byte snapshots produced during
// compression (before/after), with tool schema + history broken out. Returns
// null when either snapshot is missing or the original body has no bytes (old
// snapshots without the breakdown fields default to 0, so they still aggregate).
// This is the single seam that maps diagnostics → a lifetime-aggregateable shape;
// chatCore forwards the result through saveUsageStats → saveRequestUsage.
export function buildHeadroomBytesSample(diagnostics) {
  const before = diagnostics?.before;
  const after = diagnostics?.after;
  if (!before || !after || !(before.bodyBytes > 0)) return null;
  const seg = (b, a) => ({
    before: Number.isFinite(b) ? b : 0,
    after: Number.isFinite(a) ? a : 0,
  });
  const body = seg(before.bodyBytes, after.bodyBytes);
  const tools = seg(before.toolsBytes, after.toolsBytes);
  const history = seg(before.historyBytes, after.historyBytes);
  return {
    bodyBefore: body.before, bodyAfter: body.after,
    toolsBefore: tools.before, toolsAfter: tools.after,
    historyBefore: history.before, historyAfter: history.after,
  };
}

export function formatEffectivePayloadSavings(diagnostics) {
  const before = diagnostics?.before;
  const after = diagnostics?.after;
  if (!before || !after || !before.bodyBytes || !after.bodyBytes) return null;
  const saved = before.bodyBytes - after.bodyBytes;
  const pct = before.bodyBytes > 0 ? ((saved / before.bodyBytes) * 100).toFixed(1) : "0";
  const parts = [`effectivePayloadSavings=${pct}% body=${before.bodyBytes}B→${after.bodyBytes}B`];
  if (typeof before.toolsBytes === "number" && typeof after.toolsBytes === "number") {
    parts.push(`tools=${before.toolsBytes}B→${after.toolsBytes}B`);
  }
  if (typeof before.historyBytes === "number" && typeof after.historyBytes === "number") {
    parts.push(`history=${before.historyBytes}B→${after.historyBytes}B`);
  }
  return parts.join(" ");
}

export function isHeadroomPhantomSavings(stats, diagnostics, minShrinkRatio = 0.05) {
  if (!stats?.tokens_saved || stats.tokens_saved <= 0) return false;
  const before = diagnostics?.before?.bodyBytes || 0;
  const after = diagnostics?.after?.bodyBytes || 0;
  if (before <= 0 || after <= 0) return false;
  return after >= before * (1 - minShrinkRatio);
}
