"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/**
 * useDashboardStream — SSE client for the unified dashboard stream.
 *
 * Connects to /api/dashboard/stream and returns:
 *   - connected: boolean (live status)
 *   - stats: latest usage stats snapshot
 *   - events: array of recent breaker/health events (last 20)
 *   - reconnect: manual reconnect function
 *
 * Auto-reconnects on error with exponential backoff.
 */
export function useDashboardStream() {
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const eventSourceRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttempts = useRef(0);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource("/api/dashboard/stream");
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
      reconnectAttempts.current = 0;
    };

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (!data || !data.type) return;

        if (data.type === "snapshot") {
          // Fetch full meta on initial snapshot for complete data shape
          fetch("/api/usage/meta")
            .then((r) => r.json())
            .then((d) => { if (!d.error) setStats(d); })
            .catch(() => {});
        } else if (data.type === "usage_update") {
          // Re-fetch meta for fresh totals (the event itself is just a trigger)
          fetch("/api/usage/meta")
            .then((r) => r.json())
            .then((d) => { if (!d.error) setStats(d); })
            .catch(() => {});
        } else if (data.type === "provider_down" || data.type === "provider_recovered" || data.type === "health_update") {
          setEvents((prev) => {
            const next = [{ ...data, ts: Date.now() }, ...prev];
            return next.slice(0, 20);
          });
        }
      } catch {
        // ignore malformed
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      eventSourceRef.current = null;

      // Clear any pending reconnect timer before scheduling a new one
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);

      // Exponential backoff: 2s, 4s, 8s, max 30s
      const delay = Math.min(2000 * Math.pow(2, reconnectAttempts.current), 30000);
      reconnectAttempts.current++;
      reconnectTimerRef.current = setTimeout(connect, delay);
    };
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [connect]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { connected, stats, events, clearEvents };
}
