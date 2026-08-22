"use client";

import { useState } from "react";
import { Badge } from "@/shared/components";

// MarathonWindowSelector — dropdown for selecting Marathon's completion window.
//
// Marathon (by GoKite AI) offers 4 completion windows:
//   now     → real-time streaming (no discount)
//   soon    → short delay, small discount
//   later   → ~15 min wait, ~50% cheaper
//   anytime → best-effort, up to 65% cheaper
//
// The selected window is persisted as providerSpecificData.completionWindow
// on the connection record. The MarathonExecutor reads it at request time.
const WINDOWS = [
  { key: "now", label: "Now", desc: "Real-time streaming — no waiting", savings: "0%" },
  { key: "soon", label: "Soon", desc: "Short delay, small discount", savings: "~10%" },
  { key: "later", label: "Later", desc: "~15 min wait, ~50% cheaper", savings: "~50%" },
  { key: "anytime", label: "Anytime", desc: "Best-effort, up to 65% cheaper", savings: "up to 65%" },
];

export default function MarathonWindowSelector({ connectionId, currentWindow = "now", onWindowChanged }) {
  const [selected, setSelected] = useState(currentWindow);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = async (e) => {
    const window = e.target.value;
    setSelected(window);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/providers/${connectionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerSpecificData: { completionWindow: window } }),
      });
      if (!res.ok) throw new Error("Failed to save window");
      onWindowChanged?.(window);
    } catch (err) {
      setError(err.message);
      setSelected(currentWindow);
    } finally {
      setSaving(false);
    }
  };

  const activeWindow = WINDOWS.find((w) => w.key === selected) || WINDOWS[0];
  const isDelayed = selected !== "now";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-muted font-medium">Completion Window</span>
        <div className="relative">
          <select
            value={selected}
            onChange={handleChange}
            disabled={saving}
            title="Pick a completion window. Longer windows cost less but wait longer."
            className="appearance-none rounded-brand border border-border bg-surface-2 py-1.5 pl-3 pr-8 text-xs text-text-main [-webkit-appearance:none] [-moz-appearance:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:opacity-50"
          >
            {WINDOWS.map((w) => (
              <option key={w.key} value={w.key}>
                {w.label} ({w.savings} off)
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 text-text-muted">
            <span className="material-symbols-outlined text-[16px]">expand_more</span>
          </span>
        </div>
        {isDelayed && (
          <Badge variant="info" size="sm" icon="schedule" dot>
            Async
          </Badge>
        )}
        {saving && <Badge variant="info" size="sm">Saving…</Badge>}
        {error && <Badge variant="error" size="sm" icon="error">{error}</Badge>}
      </div>
      <p className="text-[11px] text-text-muted">
        {activeWindow.desc}
        {isDelayed && " — results polled automatically with keep-alive heartbeats."}
      </p>
    </div>
  );
}
