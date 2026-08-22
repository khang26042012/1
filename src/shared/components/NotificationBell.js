"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useNotificationStore } from "@/store/notificationStore";
import { useDashboardStream } from "@/shared/hooks/useDashboardStream";

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

const TYPE_ICONS = {
  error: { icon: "error", color: "#EF4444" },
  success: { icon: "check_circle", color: "#10B981" },
  warning: { icon: "warning", color: "#F59E0B" },
  info: { icon: "info", color: "#3B82F6" },
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const lastProcessedTs = useRef(0);
  const router = useRouter();
  const { events } = useDashboardStream();
  const { history, unreadCount, markAllRead, clearHistory } = useNotificationStore();

  // Push server events into notification store — only process NEW events
  // that are significant enough to notify the user.
  const NOTIFIABLE_TYPES = new Set([
    "provider_down",
    "provider_recovered",
    "health_degraded",
    "rate_limited",
    "budget_exceeded",
  ]);

  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0];
    // Only notify on significant events — skip health_update (too spammy)
    // and usage_update (not actionable). health_update fires every 500ms per
    // provider on any metric change; only health_degraded (success < 70%)
    // is worth surfacing as a notification.
    if (!NOTIFIABLE_TYPES.has(latest.type)) return;
    if (latest.ts && latest.ts > lastProcessedTs.current) {
      lastProcessedTs.current = latest.ts;
      useNotificationStore.getState().addServerEvent(latest);
    }
  }, [events]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = () => {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen) {
      // Defer markAllRead to next tick to avoid setState-during-render
      requestAnimationFrame(() => markAllRead());
    }
  };

  const handleNotificationClick = (item) => {
    if (item.provider) {
      router.push(`/dashboard/providers/${item.provider}`);
    }
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={handleOpen}
        className="relative flex size-9 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
        aria-label="Notifications"
      >
        <span className="material-symbols-outlined text-[20px]">notifications</span>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Notifications
            </span>
            {history.length > 0 && (
              <button
                onClick={clearHistory}
                className="text-[10px] text-text-muted transition-colors hover:text-danger"
              >
                Clear all
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8">
                <span className="material-symbols-outlined text-[32px] text-text-muted opacity-20">
                  notifications_off
                </span>
                <span className="text-xs text-text-muted">No notifications yet</span>
              </div>
            ) : (
              history.map((item) => {
                const meta = TYPE_ICONS[item.type] || TYPE_ICONS.info;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNotificationClick(item)}
                    className="flex w-full items-start gap-2.5 border-b border-border-subtle px-3 py-2.5 text-left transition-colors hover:bg-surface-2/50"
                  >
                    <div
                      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: `${meta.color}15` }}
                    >
                      <span className="material-symbols-outlined text-[14px]" style={{ color: meta.color }}>
                        {meta.icon}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      {item.title && (
                        <p className="truncate text-xs font-medium text-text-primary">
                          {item.title}
                        </p>
                      )}
                      <p className="text-xs text-text-muted line-clamp-2">
                        {item.message}
                      </p>
                      <p className="mt-0.5 text-[10px] text-text-muted/60">
                        {timeAgo(item.createdAt)}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
