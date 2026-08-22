/**
 * Notification Store — Zustand-based global toast notification system.
 * Centralized feedback for dashboard actions + server event notifications.
 *
 * Two layers:
 *   1. `notifications[]` — ephemeral toasts (auto-dismiss)
 *   2. `history[]` — persistent event log (survives page refresh via localStorage)
 *      Used by NotificationBell to show recent server events.
 */

import { create } from "zustand";

let idCounter = Date.now();

const HISTORY_KEY = "er_notification_history";
const MAX_HISTORY = 50;

// Load history from localStorage on init
function loadHistory() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    // Seed idCounter above any existing history ids to prevent key collisions
    for (const item of parsed) {
      if (typeof item.id === "number" && item.id > idCounter) idCounter = item.id;
    }
    return parsed;
  } catch {
    return [];
  }
}

function persistHistory(history) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    // non-fatal
  }
}

export const useNotificationStore = create((set, get) => ({
  notifications: [],
  history: loadHistory(),
  unreadCount: 0,

  addNotification: (notification) => {
    const id = ++idCounter;
    const entry = {
      id,
      type: notification.type || "info",
      message: notification.message,
      title: notification.title || null,
      duration: notification.duration ?? 5000,
      dismissible: notification.dismissible ?? true,
      createdAt: Date.now(),
      source: notification.source || "user", // "user" or "server"
    };

    set((s) => ({ notifications: [...s.notifications, entry] }));

    // Auto-dismiss
    if (entry.duration > 0) {
      setTimeout(() => get().removeNotification(id), entry.duration);
    }

    return id;
  },

  // Add a server-originated notification (from SSE events).
  // Shows as a toast AND adds to history + increments unread.
  addServerEvent: (event) => {
    // Skip events that produce no message (e.g. non-critical health_update).
    const message = event.message || formatEventMessage(event);
    if (!message) return null;

    const id = ++idCounter;
    const entry = {
      id,
      type: event.type === "provider_down" ? "error"
            : event.type === "provider_recovered" ? "success"
            : event.type === "health_degraded" ? "warning"
            : "info",
      message,
      title: event.title || formatEventTitle(event),
      duration: event.duration ?? 8000,
      dismissible: true,
      createdAt: Date.now(),
      source: "server",
      eventType: event.type,
      provider: event.provider,
    };

    set((s) => {
      const history = [entry, ...s.history].slice(0, MAX_HISTORY);
      persistHistory(history);
      return {
        notifications: [...s.notifications, entry],
        history,
        unreadCount: s.unreadCount + 1,
      };
    });

    if (entry.duration > 0) {
      setTimeout(() => get().removeNotification(id), entry.duration);
    }

    return id;
  },

  removeNotification: (id) => {
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
  },

  clearAll: () => set({ notifications: [] }),

  markAllRead: () => set({ unreadCount: 0 }),

  clearHistory: () => {
    persistHistory([]);
    set({ history: [], unreadCount: 0 });
  },

  success: (message, title) => get().addNotification({ type: "success", message, title }),
  error: (message, title) => get().addNotification({ type: "error", message, title, duration: 8000 }),
  warning: (message, title) => get().addNotification({ type: "warning", message, title }),
  info: (message, title) => get().addNotification({ type: "info", message, title }),
}));

function formatEventTitle(event) {
  switch (event.type) {
    case "provider_down": return "Provider Down";
    case "provider_recovered": return "Provider Recovered";
    case "health_degraded": return "Health Degraded";
    case "rate_limited": return "Rate Limited";
    case "budget_exceeded": return "Budget Exceeded";
    default: return "Notification";
  }
}

function formatEventMessage(event) {
  const provider = event.provider || "Unknown";
  switch (event.type) {
    case "provider_down": return `${provider} circuit breaker opened — requests blocked temporarily.`;
    case "provider_recovered": return `${provider} recovered — circuit breaker closed.`;
    case "health_degraded": return `${provider} success rate dropped below 70%.`;
    case "rate_limited": return `${provider} hit rate limit (429/403).`;
    case "budget_exceeded": return `Budget limit reached for ${provider}.`;
    case "health_update":
      // Health updates are too frequent to be notifications; only surface if
      // success rate is critically low (< 50%).
      if (event.successRate != null && event.successRate < 0.5) {
        return `${provider} is unhealthy — ${Math.round(event.successRate * 100)}% success rate (${event.failures || 0} failures).`;
      }
      return null; // Returning null means: don't create a notification for this.
    default: return null; // Unknown types → don't create notification.
  }
}
