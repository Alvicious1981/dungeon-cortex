"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CircleAlert, RotateCcw } from "lucide-react";

export default function CampaignError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Campaign Segment Error Boundary caught:", error);
  }, [error]);

  return (
    <main className="dc-atmosphere flex min-h-screen items-center justify-center p-4 text-[#e2d9c5]">
      <section role="alert" aria-labelledby="campaign-error-title" className="dc-panel w-full max-w-lg space-y-5 rounded-sm p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-red-400/35 bg-red-950/40 text-red-300">
            <CircleAlert aria-hidden="true" size={22} />
          </span>
          <div>
            <p className="dc-kicker text-red-300">Recoverable interruption</p>
            <h2 id="campaign-error-title" className="dc-heading mt-1 text-xl font-bold text-red-200">Chronicle Interrupted</h2>
          </div>
        </div>
        <p className="dc-copy text-base leading-7 text-[#cbbda5]">This campaign could not be read safely. Retry the request, or return to the Hall of Records; no local rule result is fabricated while the chronicle is unavailable.</p>
        <div className="grid gap-3 pt-1 sm:grid-cols-2">
          <button type="button" onClick={reset} className="dc-button-primary rounded-sm px-4 py-3 text-sm">
            <RotateCcw aria-hidden="true" className="mr-2" size={17} /> Retry
          </button>
          <Link href="/" className="flex min-h-11 items-center justify-center rounded-sm border border-[#4a405b] bg-[#15121e] px-4 py-3 text-center text-sm font-semibold text-[#d2c6a8] hover:border-[#79688e]">Leave campaign</Link>
        </div>
      </section>
    </main>
  );
}
