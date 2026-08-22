"use client";

// Kimchi ToolCard — minimum card: label, description, install link.
// Mirrors default card until a /api/cli-tools/kimchi-settings backend lands.

import { useState } from "react";
import { Card } from "@/shared/components";
import Image from "next/image";

export default function KimchiToolCard({ tool, isExpanded, onToggle }) {
  const [showGuide, setShowGuide] = useState(false);

  return (
    <Card className="overflow-hidden">
      <button
        className="flex w-full items-center gap-3 p-4 text-left"
        onClick={onToggle}
        aria-expanded={!!isExpanded}
      >
        <Image
          src={tool.image}
          alt={tool.name}
          width={32}
          height={32}
          className="size-8 rounded-lg object-contain"
          sizes="32px"
          onError={(e) => { e.target.style.display = "none"; }}
        />
        <span className="flex-1">
          <span className="block font-medium">{tool.name}</span>
          <span className="block text-sm text-text-muted">{tool.description}</span>
        </span>
        <span className="text-text-muted">{isExpanded ? "▾" : "▸"}</span>
      </button>

      {isExpanded && (
        <div className="border-t border-border p-4 text-sm text-text-muted">
          <p>
            Kimchi CLI routes through ExtremeRouter via its config file on your machine.
          </p>
          <button
            className="mt-3 text-primary underline"
            onClick={() => setShowGuide((v) => !v)}
          >
            {showGuide ? "Hide install guide" : "Show install guide"}
          </button>
          {showGuide && (
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li>Install Kimchi CLI from <a className="text-primary underline" href="https://kimchi.app" target="_blank" rel="noreferrer">kimchi.app</a>.</li>
              <li>Point its base URL at your ExtremeRouter instance and use an API key from this dashboard.</li>
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}