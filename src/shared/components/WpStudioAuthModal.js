"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";

/**
 * WordPress Studio Code Auth Modal
 *
 * Auto-detects credentials from ~/.studio/shared.json (Studio Code login).
 * User clicks "Import" to validate the token and create a connection.
 * No manual token entry needed — Studio Code handles the login.
 */
export default function WpStudioAuthModal({ isOpen, onSuccess, onClose }) {
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [found, setFound] = useState(false);
  const [email, setEmail] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState(null);

  const checkCredentials = async () => {
    setChecking(true);
    setError(null);
    setFound(false);
    try {
      const res = await fetch("/api/oauth/wp-studio/import");
      const data = await res.json();
      if (data.found) {
        setFound(true);
        setEmail(data.email || "");
        setExpiresAt(data.expiresAt || "");
      } else {
        setError(data.error || "Studio Code credentials not found");
      }
    } catch {
      setError("Failed to check Studio Code credentials");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (isOpen) checkCredentials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    try {
      const res = await fetch("/api/oauth/wp-studio/import", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Connect WordPress Studio Code" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Checking state */}
        {checking && (
          <div className="text-center py-6">
            <div className="size-12 mx-auto mb-3 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl text-primary animate-spin">progress_activity</span>
            </div>
            <p className="text-sm text-text-muted">Checking for Studio Code...</p>
          </div>
        )}

        {/* Found credentials */}
        {!checking && found && (
          <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800">
            <div className="flex gap-2">
              <span className="material-symbols-outlined text-green-600 dark:text-green-400">check_circle</span>
              <div className="text-sm text-green-800 dark:text-green-200">
                <p className="font-medium">Studio Code detected!</p>
                {email && <p className="text-xs mt-0.5">{email}</p>}
                {expiresAt && (
                  <p className="text-xs mt-0.5 text-green-600 dark:text-green-400">
                    Token expires: {new Date(expiresAt).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Not found */}
        {!checking && !found && !error && (
          <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Studio Code credentials not found. Install{" "}
              <a href="https://developer.wordpress.com/studio/" target="_blank" rel="noopener noreferrer" className="underline font-medium">
                WordPress Studio Code
              </a>{" "}
              and log in, then click Retry.
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex gap-2">
            <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-[18px]">info</span>
            <div className="text-xs text-blue-800 dark:text-blue-200 space-y-1">
              <p><strong>How it works:</strong></p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Install <a href="https://developer.wordpress.com/studio/" target="_blank" rel="noopener noreferrer" className="underline">WordPress Studio Code</a></li>
                <li>Log in with your WordPress.com account (free)</li>
                <li>Click &quot;Import&quot; — we read your token automatically</li>
              </ol>
              <p className="mt-1">Token expires in 14 days. Re-import after expiry.</p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          {!checking && !found && (
            <Button onClick={checkCredentials} variant="outline" fullWidth>
              Retry
            </Button>
          )}
          {found && (
            <Button onClick={handleImport} fullWidth disabled={importing}>
              {importing ? "Importing..." : "Import Credentials"}
            </Button>
          )}
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

WpStudioAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
