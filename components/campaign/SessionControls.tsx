"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SessionView {
  sessionNumber: number;
  status: "ACTIVE" | "PAUSED" | "COMPLETED";
  mode: string;
}

export default function SessionControls({
  campaignId,
  session,
}: {
  campaignId: string;
  session: SessionView | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function command(action: "pause" | "resume" | "complete") {
    if (pending) return;
    if (action === "complete" && !window.confirm("Complete this session and seal its summary?")) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/campaign/${campaignId}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? `Session command failed (${response.status}).`);
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Session command failed.");
    } finally {
      setPending(false);
    }
  }

  if (!session) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2" aria-label="Session state">
        <span className="min-h-11 rounded-full border border-[#4f4264] px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-[#c4b5fd]">
          Sesión sin iniciar
        </span>
      </div>
    );
  }

  const status = session.status;
  const mode = session.mode;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2" aria-label="Session state">
      <span className="min-h-11 rounded-full border border-[#4f4264] px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-[#c4b5fd]">
        Session {session.sessionNumber} · {mode.toLowerCase()}
      </span>
      {status === "PAUSED" ? (
        <button type="button" disabled={pending} onClick={() => command("resume")} className="min-h-11 rounded-sm border border-emerald-700/70 px-3 text-xs font-semibold uppercase tracking-wider text-emerald-200 disabled:opacity-50">
          Resume
        </button>
      ) : status !== "COMPLETED" ? (
        <button type="button" disabled={pending} onClick={() => command("pause")} className="min-h-11 rounded-sm border border-[#4f4264] px-3 text-xs font-semibold uppercase tracking-wider text-[#d8c9aa] disabled:opacity-50">
          Pause
        </button>
      ) : null}
      {status !== "COMPLETED" && (
        <button type="button" disabled={pending} onClick={() => command("complete")} className="min-h-11 rounded-sm border border-red-900/70 px-3 text-xs font-semibold uppercase tracking-wider text-red-200 disabled:opacity-50">
          End session
        </button>
      )}
      {error && <span role="alert" className="w-full text-right text-sm text-red-300">{error}</span>}
    </div>
  );
}
