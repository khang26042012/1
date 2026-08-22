"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";

/**
 * QwenAuthModal — 2-field credential import for Qwen Web.
 *
 * Qwen's v2 API (chat.qwen.ai) requires the full browser cookie jar for WAF
 * bypass, plus a per-session bx-umidtoken anti-bot header that the browser
 * generates dynamically (not stored as a cookie).
 *
 *   1. Cookie jar (apiKey) — required. Full Cookie header from chat.qwen.ai.
 *   2. bx-umidtoken — optional but recommended. Captures from DevTools →
 *      Network → any /api/v2/ request → Request Headers → bx-umidtoken.
 *      Without a valid value, the static fallback may be rejected by the WAF
 *      ("unauthorized" error).
 */
export default function QwenAuthModal({ isOpen, onSuccess, onClose }) {
  const [cookies, setCookies] = useState("");
  const [umidToken, setUmidToken] = useState("");
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    if (!cookies.trim()) {
      setError("Please enter your full Cookie header from chat.qwen.ai");
      return;
    }
    if (!cookies.includes("token=")) {
      setError("Cookie jar is missing the 'token' cookie — did you copy the full Cookie header?");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/qwen/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cookies: cookies.trim(),
          umidToken: umidToken.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Connect Qwen Web" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Instructions */}
        <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex gap-2">
            <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-[18px]">info</span>
            <div className="text-xs text-blue-800 dark:text-blue-200 space-y-1">
              <p>Log in at <a href="https://chat.qwen.ai" target="_blank" rel="noopener noreferrer" className="underline font-medium">chat.qwen.ai</a>, open DevTools → Network.</p>
              <p>Find any request to <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">api/v2/</code> and copy the full Cookie header.</p>
              <p>Optionally copy the <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">bx-umidtoken</code> request header value — this bypasses the anti-bot check.</p>
            </div>
          </div>
        </div>

        {/* Cookie Jar */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Cookie Header <span className="text-red-500">*</span>
          </label>
          <textarea
            value={cookies}
            onChange={(e) => setCookies(e.target.value)}
            placeholder="cna=xxx; ssxmod_itna=xxx; token=eyJ...; isg=xxx; ..."
            rows={3}
            className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:border-primary resize-none"
          />
          <p className="text-[11px] text-text-muted mt-1">
            Must include <code className="bg-black/5 dark:bg-white/5 px-1 rounded">cna</code>, <code className="bg-black/5 dark:bg-white/5 px-1 rounded">ssxmod_itna</code>, and <code className="bg-black/5 dark:bg-white/5 px-1 rounded">token</code> cookies
          </p>
        </div>

        {/* bx-umidtoken (optional) */}
        <div>
          <label className="block text-sm font-medium mb-2">
            bx-umidtoken <span className="text-text-muted font-normal">(optional)</span>
          </label>
          <Input
            value={umidToken}
            onChange={(e) => setUmidToken(e.target.value)}
            placeholder="T2gAnGqZ6RnL7evLHLylTWRk83L4vDr6l04..."
            className="font-mono text-sm"
          />
          <p className="text-[11px] text-text-muted mt-1">
            Copy from DevTools &rarr; Network &rarr; request headers. Without a valid value, the API may return &quot;unauthorized&quot;.
          </p>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleImport}
            fullWidth
            disabled={importing || !cookies.trim()}
          >
            {importing ? "Importing..." : "Import Credentials"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

QwenAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
