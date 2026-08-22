"use client";

import { useState } from "react";
import Card from "@/shared/components/Card";

function formatDollars(amount) {
  if (amount === 0) return "$0.00";
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(4)}`;
}

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1048576) return `${(v / 1048576).toFixed(1)}MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)}KB`;
  return `${Math.round(v)}B`;
}

const MECHANISM_META = [
  { key: "rtk", label: "RTK", icon: "compress", color: "#3B82F6" },
  { key: "headroom", label: "Headroom", icon: "expand_less", color: "#10B981" },
  { key: "pxpipe", label: "Pxpipe", icon: "image_search", color: "#8B5CF6" },
  { key: "cache", label: "Cache", icon: "cached", color: "#F59E0B" },
  { key: "caveman", label: "Caveman", icon: "short_text", color: "#EF4444" },
  { key: "ponytail", label: "Ponytail", icon: "code", color: "#EC4899" },
];

export default function SavingsCard({ data }) {
  const [expanded, setExpanded] = useState(false);

  const costSaved = data?.costSavedLifetime || 0;
  const byMechanism = data?.costSavedByMechanism || {};
  const tokensSaved = data?.tokensSavedLifetime || 0;

  // Headroom effective payload savings (byte-level): actual outbound JSON
  // shrink, tool schema + history broken out. Null until compression has
  // produced at least one before/after byte snapshot.
  const headroomBytes = data?.bytesSavedByMechanism?.headroom || null;
  const headroomPct = headroomBytes?.bodyBefore > 0
    ? (((headroomBytes.bodyBefore - headroomBytes.bodyAfter) / headroomBytes.bodyBefore) * 100).toFixed(1)
    : null;

  // Calculate "without ExtremeRouter" cost = actual cost + saved cost
  const actualCost = data?.totalCost || 0;
  const withoutCost = actualCost + costSaved;

  return (
    <Card padding="md" className="relative overflow-hidden">
      {/* Subtle gradient background */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />

      <div className="relative flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* Hero icon */}
          <div className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10">
            <span className="material-symbols-outlined text-[32px] text-emerald-500">
              payments
            </span>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Total Dollar Savings
            </p>
            <p className="text-3xl font-bold text-emerald-500">
              {formatDollars(costSaved)}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              {tokensSaved.toLocaleString()} tokens saved across all mechanisms
            </p>
          </div>
        </div>

        {/* Comparison badge */}
        <div className="hidden flex-col items-end gap-1 sm:flex">
          <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5">
            <span className="text-xs text-text-muted">Without ER:</span>
            <span className="text-sm font-semibold text-red-500 line-through opacity-70">
              {formatDollars(withoutCost)}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-1.5">
            <span className="text-xs text-emerald-600 dark:text-emerald-400">With ER:</span>
            <span className="text-sm font-semibold text-emerald-500">
              {formatDollars(actualCost)}
            </span>
          </div>
        </div>
      </div>

      {/* Expandable mechanism breakdown */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="relative mt-3 flex w-full items-center justify-between rounded-lg bg-surface-2/50 px-3 py-2 text-left transition-colors hover:bg-surface-2"
      >
        <span className="text-xs font-medium text-text-muted">
          Savings by mechanism
        </span>
        <span className="material-symbols-outlined text-[16px] text-text-muted transition-transform" style={{ transform: expanded ? "rotate(180deg)" : "none" }}>
          expand_more
        </span>
      </button>

      {expanded && (
        <div className="relative mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {MECHANISM_META.map((mech) => {
            const amount = byMechanism[mech.key] || 0;
            const pct = costSaved > 0 ? (amount / costSaved) * 100 : 0;
            return (
              <div
                key={mech.key}
                className="flex items-center gap-2 rounded-lg border border-border-subtle px-2.5 py-2"
              >
                <div
                  className="flex size-7 shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: `${mech.color}15` }}
                >
                  <span className="material-symbols-outlined text-[14px]" style={{ color: mech.color }}>
                    {mech.icon}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-text-primary">
                    {mech.label}
                  </p>
                  <p className="text-xs text-text-muted">
                    {formatDollars(amount)} <span className="opacity-50">({pct.toFixed(0)}%)</span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {headroomPct !== null && (
        <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <span className="material-symbols-outlined text-[14px]">expand_less</span>
            Headroom effective payload savings: {headroomPct}% outbound
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            body {formatBytes(headroomBytes.bodyBefore)} → {formatBytes(headroomBytes.bodyAfter)}
            {headroomBytes.toolsBefore > 0 && ` · tools ${formatBytes(headroomBytes.toolsBefore)} → ${formatBytes(headroomBytes.toolsAfter)}`}
            {headroomBytes.historyBefore > 0 && ` · history ${formatBytes(headroomBytes.historyBefore)} → ${formatBytes(headroomBytes.historyAfter)}`}
            {headroomBytes.requests > 0 && ` · ${headroomBytes.requests.toLocaleString()} compressed request${headroomBytes.requests === 1 ? "" : "s"}`}
          </p>
        </div>
      )}
    </Card>
  );
}
