"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Modal, Input, Button, Badge } from "@/shared/components";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

const NODE_TYPE_INFO = {
  "custom-embedding": { label: "Embedding", add: "Add Custom Embedding", edit: "Edit Custom Embedding", modelHint: "e.g. voyage-3, embed-english-v3.0, text-embedding-3-small", modelRequired: true },
  "custom-stt": { label: "STT", add: "Add Custom STT", edit: "Edit Custom STT", modelHint: "e.g. whisper-large-v3, whisper-1", modelRequired: true },
  "custom-tts": { label: "TTS", add: "Add Custom TTS", edit: "Edit Custom TTS", modelHint: "e.g. kokoro-v1, af_heart", modelRequired: false },
};

// Dual-mode modal: edit when `node` provided, add otherwise.
// nodeType selects which self-hosted kind is created/validated.
export default function AddCustomEmbeddingModal({ isOpen, onClose, onCreated, onSaved, node, nodeType = "custom-embedding" }) {
  const isEdit = !!node;
  const info = NODE_TYPE_INFO[nodeType] || NODE_TYPE_INFO["custom-embedding"];
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    baseUrl: DEFAULT_BASE_URL,
  });
  const [submitting, setSubmitting] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setValidationResult(null);
    setCheckKey("");
    setCheckModelId("");
    if (isEdit) {
      setFormData({
        name: node.name || "",
        prefix: node.prefix || "",
        baseUrl: node.baseUrl || DEFAULT_BASE_URL,
      });
    } else {
      setFormData({ name: "", prefix: "", baseUrl: DEFAULT_BASE_URL });
    }
  }, [isOpen, isEdit, node]);

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSubmitting(true);
    try {
      const url = isEdit ? `/api/provider-nodes/${node.id}` : "/api/provider-nodes";
      const method = isEdit ? "PUT" : "POST";
      const payload = {
        name: formData.name,
        prefix: formData.prefix,
        baseUrl: formData.baseUrl,
      };
      if (!isEdit) payload.type = nodeType;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        if (isEdit) onSaved?.(data.node);
        else onCreated?.(data.node);
      }
    } catch (error) {
      console.log("Error saving custom node:", error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey || undefined,
          type: nodeType,
          modelId: checkModelId.trim() || undefined,
        }),
      });
      const data = await res.json();
      setValidationResult(data);
    } catch {
      setValidationResult({ valid: false, error: "Network error" });
    } finally {
      setValidating(false);
    }
  };

  const renderValidationResult = () => {
    if (!validationResult) return null;
    const { valid, error, dimensions } = validationResult;
    if (valid) {
      return (
        <>
          <Badge variant="success">Valid</Badge>
          {dimensions && <span className="text-sm text-text-muted">{dimensions} dims</span>}
        </>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <Badge variant="error">Invalid</Badge>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} title={isEdit ? info.edit : info.add} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Voyage AI"
          hint="Required. A friendly label for this provider."
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder="voyage"
          hint="Required. Used as the provider prefix for model IDs (e.g. voyage/voyage-3)."
        />
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder="http://localhost:8000"
          hint="Self-hosted OpenAI-compatible endpoint. One node can front several machines."
        />
        <Input
          label="API Key (for Check)"
          type="password"
          value={checkKey}
          onChange={(e) => setCheckKey(e.target.value)}
          hint="Optional. Leave empty if your server runs keyless."
        />
        <Input
          label="Model ID (for Check)"
          value={checkModelId}
          onChange={(e) => setCheckModelId(e.target.value)}
          placeholder={info.modelHint}
          hint={info.modelRequired ? "Required for validation. Will send a test request." : "Optional. Will send a test request."}
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={handleValidate}
            disabled={!formData.baseUrl.trim() || (info.modelRequired && !checkModelId.trim()) || validating}
            variant="secondary"
          >
            {validating ? "Checking..." : "Check"}
          </Button>
          {renderValidationResult()}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || submitting}
          >
            {submitting ? (isEdit ? "Saving..." : "Creating...") : (isEdit ? "Save" : "Create")}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

AddCustomEmbeddingModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func,
  onSaved: PropTypes.func,
  node: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    prefix: PropTypes.string,
    baseUrl: PropTypes.string,
  }),
  nodeType: PropTypes.oneOf(["custom-embedding", "custom-stt", "custom-tts"]),
};
