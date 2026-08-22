"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/shared/components";

// AgnesProfile — shows the connected Agnes credit balance.
export default function AgnesProfile({ connectionId }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!connectionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/providers/${connectionId}/agnes-profile`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setProfile(data);
        }
      } catch {
        // non-fatal
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [connectionId]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-2/50 px-3 py-2">
        <div className="size-8 animate-pulse rounded-full bg-sidebar" />
        <div className="flex flex-col gap-1">
          <div className="h-3 w-32 animate-pulse rounded bg-sidebar" />
          <div className="h-2 w-48 animate-pulse rounded bg-sidebar" />
        </div>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-2/50 px-3 py-2">
      <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
        AG
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-text-main">Agnes</p>
          {profile.username && (
            <Badge variant="primary" size="sm">@{profile.username}</Badge>
          )}
        </div>
        {profile.credits != null && (
          <p className="mt-0.5 text-xs text-text-muted">
            Credits: {Number(profile.credits).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
