"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function CampaignError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Campaign Segment Error Boundary caught:", error);
  }, [error]);

  return (
    <div 
      className="flex-1 flex items-center justify-center p-4 bg-neutral-950/80"
      style={{ fontFamily: "var(--font-crimson), serif" }}
    >
      <div 
        className="w-full max-w-lg p-6 rounded border space-y-4"
        style={{
          background: "rgba(18, 12, 12, 0.95)",
          borderColor: "rgba(220, 38, 38, 0.2)",
          boxShadow: "0 4px 20px rgba(220, 38, 38, 0.1)"
        }}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">🔮</span>
          <h2 
            className="text-lg font-bold uppercase tracking-wider text-red-400"
            style={{ fontFamily: "var(--font-cinzel), serif" }}
          >
            Chronicle Interrupted
          </h2>
        </div>
        
        <p className="text-sm text-red-200/80 leading-relaxed">
          The connection to this campaign&#39;s thread of fate has been severed. A sudden arcane interference or temporal anomaly prevents further scrying into this adventure.
        </p>

        <div className="pt-2 flex gap-3 text-sm font-semibold tracking-wide uppercase" style={{ fontFamily: "var(--font-cinzel), serif" }}>
          <button
            onClick={() => reset()}
            className="flex-1 py-2 px-4 rounded transition-colors"
            style={{
              background: "rgba(220,38,38,0.1)",
              color: "#FCA5A5",
              border: "1px solid rgba(220,38,38,0.3)"
            }}
          >
            Recast Spell (Retry)
          </button>
          
          <Link
            href="/"
            className="flex-1 py-2 px-4 text-center rounded transition-colors"
            style={{
              background: "rgba(255,255,255,0.05)",
              color: "#D4D4D4",
              border: "1px solid rgba(255,255,255,0.1)"
            }}
          >
            Leave Campaign
          </Link>
        </div>
      </div>
    </div>
  );
}
