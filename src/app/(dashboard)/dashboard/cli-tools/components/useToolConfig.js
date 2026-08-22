"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * useToolConfig — shared state management hook for CLI ToolCards.
 *
 * Eliminates the ~290-line duplication across 22 ToolCard components by
 * centralizing: status fetch, apply settings, reset settings, model alias
 * fetch, API key selection, and message state.
 *
 * Each ToolCard previously re-implemented checkStatus/handleApply/handleReset
 * with identical logic but different endpoint URLs. This hook takes the
 * tool's settings endpoint and provides all the state+actions.
 *
 * @param {string} settingsEndpoint - e.g. "/api/cli-tools/cline-settings"
 * @param {boolean} isExpanded - whether the card is expanded (triggers status fetch)
 * @param {Object} options
 * @param {Array} options.apiKeys - list of { key, name } API keys
 * @param {string} options.baseUrl - gateway base URL
 * @param {boolean} options.cloudEnabled
 * @param {Object} options.initialStatus
 * @param {string} options.settingsModelField - field name in settings for the model id (default: "openAiModelId")
 * @param {string} options.settingsUrlField - field name in settings for base URL (default: "openAiBaseUrl")
 */
export function useToolConfig(settingsEndpoint, isExpanded, options = {}) {
  const {
    apiKeys = [],
    baseUrl = "",
    cloudEnabled = false,
    initialStatus = null,
    settingsModelField = "openAiModelId",
    settingsUrlField = "openAiBaseUrl",
  } = options;

  const [status, setStatus] = useState(initialStatus);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [modelAliases, setModelAliases] = useState({});

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) setSelectedApiKey(apiKeys[0].key);
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (status?.settings?.[settingsModelField]) {
      setSelectedModel(status.settings[settingsModelField]);
    }
  }, [status, settingsModelField]);

  useEffect(() => {
    if (isExpanded && !status) {
      checkStatus();
      fetchModelAliases();
    }
    if (isExpanded) fetchModelAliases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch {
      // non-fatal
    }
  };

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch(settingsEndpoint);
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      setStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  }, [settingsEndpoint]);

  const handleApply = useCallback(
    async (overrides = {}) => {
      setApplying(true);
      setMessage(null);
      try {
        const keyToUse =
          selectedApiKey && selectedApiKey.trim()
            ? selectedApiKey
            : !cloudEnabled
              ? "sk_extremerouter"
              : selectedApiKey;

        // Default: append /v1 for OpenAI-compatible tools. Tools with a
        // different path (e.g. Antigravity) should pass { baseUrl: customUrl }
        // in overrides to replace this default.
        const effectiveBaseUrl = `${baseUrl}/v1`;
        const res = await fetch(settingsEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseUrl: effectiveBaseUrl,
            apiKey: keyToUse,
            model: selectedModel,
            ...overrides,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          setMessage({ type: "success", text: "Settings applied successfully!" });
          checkStatus();
        } else {
          setMessage({ type: "error", text: data.error || "Failed to apply settings" });
        }
      } catch (error) {
        setMessage({ type: "error", text: error.message });
      } finally {
        setApplying(false);
      }
    },
    [settingsEndpoint, selectedApiKey, selectedModel, baseUrl, cloudEnabled, checkStatus],
  );

  const handleReset = useCallback(async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch(settingsEndpoint, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  }, [settingsEndpoint, checkStatus]);

  const clearMessage = useCallback(() => setMessage(null), []);

  return {
    // state
    status,
    checking,
    applying,
    restoring,
    message,
    selectedApiKey,
    selectedModel,
    modelAliases,
    // setters
    setSelectedApiKey,
    setSelectedModel,
    setMessage,
    // actions
    checkStatus,
    handleApply,
    handleReset,
    fetchModelAliases,
    clearMessage,
  };
}
