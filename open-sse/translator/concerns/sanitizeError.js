/**
 * Sanitize untrusted upstream error text: strip stack traces / file paths and
 * clamp length so provider strings never reach the client verbatim (they may
 * be rendered as HTML). Shared by the response translators.
 *
 * @param {unknown} raw - raw error message / type / code from upstream
 * @returns {string} sanitized, clamped message (never empty)
 */
export function sanitizeUpstreamError(raw) {
  if (!raw) return "Unknown error";
  return (
    String(raw)
      .replace(/at\s+.*?\(.*?\)/g, "")
      .replace(/\/[^\s:]+\/[\w.-]+/g, "<path>")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300) || "Unknown error"
  );
}