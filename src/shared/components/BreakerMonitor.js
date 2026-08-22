"use client";

import { useState, useEffect, useCallback } from "react";
import Button from "@/shared/components/Button";
import Badge from "@/shared/components/Badge";
import EmptyState from "@/shared/components/EmptyState";

// Breaker state → badge presentation.
const STATE_META = {
  closed:   { label: "Closed",             variant: "success" },
  halfOpen: { label: "Half-open (probing)", variant: "warning" },
  open:     { label: "Open",               variant: "error" },
};

function formatCooldown(ms) {
  if (ms == null) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

// "provider" or "provider:proxy:<id>" → display just the provider stem.
function providerStem(key) {
  const base = String(key || "").split(":")[0];
  return base || key;
}

/**
 * Client component for the /api/breaker endpoint. Lists every circuit breaker
 * entry with its state and a "Close breaker" (reset) control. Polls every 3s so
 * cooldown countdown and recovered breakers stay in sync.
 */
export default function BreakerMonitor() {
  const [breakers, setBreakers] = useState([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/breaker");
      if (!res.ok) return;
      const data = await res.json();
      setBreakers(data.breakers || []);
    } catch {
      // transient — next poll will retry
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  const resetOne = async (key) => {
    try {
      await fetch("/api/breaker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: key, key }),
      });
    } catch { /* ignore */ }
    load();
  };

  const resetAll = async () => {
    for (const b of breakers) {
      try {
        await fetch("/api/breaker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: b.provider, key: b.provider }),
        });
      } catch { /* ignore */ }
    }
    load();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-main">Circuit Breakers</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" icon="refresh" onClick={load}>Refresh</Button>
          {breakers.length > 0 && (
            <Button size="sm" variant="danger" icon="bolt" onClick={resetAll}>Reset all</Button>
          )}
        </div>
      </div>

      {breakers.length === 0 ? (
        <EmptyState
          icon="bolt"
          title="No opened circuit breakers"
          description="Breakers trip when a provider repeatedly fails and recover automatically after cooldown. Opened breakers will appear here so you can inspect or force-close them."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {breakers.map((b) => {
            const meta = STATE_META[b.state] || STATE_META.closed;
            return (
              <div key={b.provider} className="rounded-panel border border-border-subtle bg-panel p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs font-semibold text-text-main">{providerStem(b.provider)}</div>
                    <div className="truncate text-[11px] text-text-subtle">{b.provider}</div>
                  </div>
                  <Badge variant={meta.variant} dot size="sm">{meta.label}</Badge>
                </div>

                <div className="mt-2 flex items-center justify-between text-xs text-text-muted">
                  <span>Failures: <span className="font-mono">{b.failures}</span></span>
                  {b.state === "open" && (
                    <span>Cooldown: <span className="font-mono">{formatCooldown(b.cooldownRemainingMs)}</span></span>
                  )}
                </div>

                <Button
                  size="sm"
                  variant="secondary"
                  icon="replay"
                  className="mt-3 w-full"
                  onClick={() => resetOne(b.provider)}
                >
                  Close breaker
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
