"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";

/**
 * 1min.ai Auth Modal — 3-field credential import.
 *
 * 1min.ai's web API requires 3 pieces of information:
 *   1. JWT token (x-auth-token Bearer value) — primary API authentication
 *   2. Team ID (UUID in the API URL path: /teams/{teamId}/...)
 *   3. Cookies (optional — cf_clearance for Cloudflare bypass on api.1min.ai)
 *
 * The JWT payload only contains the user UUID, NOT the team UUID, so teamId
 * must be provided separately (visible in any api.1min.ai request URL in DevTools).
 */
export default function OneMinAuthModal({ isOpen, onSuccess, onClose }) {
  const [jwt, setJwt] = useState("");
  const [teamId, setTeamId] = useState("");
  const [cookies, setCookies] = useState("");
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    if (!jwt.trim()) {
      setError("Please enter your JWT token");
      return;
    }
    if (!teamId.trim()) {
      setError("Please enter your Team ID");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/1min/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jwt: jwt.trim(),
          teamId: teamId.trim(),
          cookies: cookies.trim(),
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
    <Modal isOpen={isOpen} title="Connect 1min.ai" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Instructions */}
        <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex gap-2">
            <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-[18px]">info</span>
            <div className="text-xs text-blue-800 dark:text-blue-200 space-y-1">
              <p>Log in at <a href="https://app.1min.ai/code-generator" target="_blank" rel="noopener noreferrer" className="underline font-medium">app.1min.ai/code-generator</a>, open DevTools → Network.</p>
              <p>Find any request to <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">api.1min.ai/teams/...</code> and copy:</p>
            </div>
          </div>
        </div>

        {/* JWT Token */}
        <div>
          <label className="block text-sm font-medium mb-2">
            JWT Token <span className="text-red-500">*</span>
          </label>
          <textarea
            value={jwt}
            onChange={(e) => setJwt(e.target.value)}
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            rows={3}
            className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:border-primary resize-none"
          />
          <p className="text-[11px] text-text-muted mt-1">
            From the <code className="bg-black/5 dark:bg-white/5 px-1 rounded">x-auth-token</code> request header (starts with &quot;Bearer eyJ...&quot;)
          </p>
        </div>

        {/* Team ID */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Team ID <span className="text-red-500">*</span>
          </label>
          <Input
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            placeholder="3cf6f69c-2006-4ce2-93d5-de493365e967"
            className="font-mono text-sm"
          />
          <p className="text-[11px] text-text-muted mt-1">
            The UUID in the API URL path: <code className="bg-black/5 dark:bg-white/5 px-1 rounded">api.1min.ai/teams/{"<Team ID>"}/...</code>
          </p>
        </div>

        {/* Cookies (optional) */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Cookies <span className="text-text-muted font-normal">(optional)</span>
          </label>
          <textarea
            value={cookies}
            onChange={(e) => setCookies(e.target.value)}
            placeholder="cf_clearance=...; mp_..._mixpanel=..."
            rows={2}
            className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:border-primary resize-none"
          />
          <p className="text-[11px] text-text-muted mt-1">
            Full Cookie header — needed if api.1min.ai is behind Cloudflare for your region
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
            disabled={importing || !jwt.trim() || !teamId.trim()}
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

OneMinAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
