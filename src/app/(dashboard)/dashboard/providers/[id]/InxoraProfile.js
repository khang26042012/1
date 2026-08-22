"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/shared/components";

// InxoraProfile — shows the connected InxoraStudio Labs user's name, email,
// plan, and API key. Fetches from /api/providers/[id]/inxora-profile on mount.
export default function InxoraProfile({ connectionId }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!connectionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/providers/${connectionId}/inxora-profile`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setProfile(data);
        }
      } catch {
        // non-fatal
      } finally {
        // Fix #14: always finish loading — previously `return` on !res.ok
        // bypassed setLoading(false), leaving skeleton visible forever.
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
      {/* Avatar */}
      <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
        {profile.name?.charAt(0)?.toUpperCase() || "I"}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-text-main">{profile.name}</p>
          {profile.email && (
            <span className="truncate text-xs text-text-muted">{profile.email}</span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          {profile.plan && (
            <Badge variant={profile.plan === "FREE" ? "default" : "primary"} size="sm">
              {profile.plan}
            </Badge>
          )}
          {profile.isActive === false && (
            <Badge variant="danger" size="sm">Inactive</Badge>
          )}
        </div>
      </div>
    </div>
  );
}
