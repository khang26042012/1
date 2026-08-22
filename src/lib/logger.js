/**
 * Structured logger for ExtremeRouter.
 *
 * Wraps console.* so the existing consoleLogBuffer (which streams to the
 * dashboard console-log page) still captures output. Adds structured context
 * (tag, level, timestamp) without breaking the buffer's patching.
 *
 * Usage:
 *   import { log } from "@/lib/logger";
 *   log.info("AUTH", "User logged in", { userId });
 *   log.warn("BREAKER", "Provider tripped", { provider, failures });
 *   log.error("DB", "Migration failed", { version, error: err.message });
 *
 * The tag is a short uppercase category (e.g. "AUTH", "BREAKER", "COMBO",
 * "TOKEN_REFRESH", "SSRF", "DB"). Keep tags consistent for filtering.
 *
 * For open-sse/ (which can't import from @/lib due to framework boundary),
 * use the executor's `log` parameter passed to execute() instead.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// Minimum level to output. Set via env or default to "debug" in dev, "info" in prod.
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug")).toLowerCase()] ?? 0;

function formatEntry(level, tag, message, context) {
  const ts = new Date().toISOString();
  const ctxStr = context && Object.keys(context).length > 0 ? " " + JSON.stringify(context) : "";
  return `[${ts}] [${level.toUpperCase()}] [${tag}] ${message}${ctxStr}`;
}

function emit(level, tag, message, context) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const formatted = formatEntry(level, tag, message, context);
  // Delegate to console so consoleLogBuffer captures it for the dashboard.
  // consoleLogBuffer patches console.log/info/warn/error/debug globally.
  if (level === "error") {
    console.error(formatted);
  } else if (level === "warn") {
    console.warn(formatted);
  } else if (level === "debug") {
    console.debug(formatted);
  } else {
    console.log(formatted);
  }
}

export const logger = {
  debug: (tag, message, context) => emit("debug", tag, message, context),
  info: (tag, message, context) => emit("info", tag, message, context),
  warn: (tag, message, context) => emit("warn", tag, message, context),
  error: (tag, message, context) => emit("error", tag, message, context),
};

export default logger;
