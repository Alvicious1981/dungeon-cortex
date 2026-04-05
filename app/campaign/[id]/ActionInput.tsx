"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  campaignId: string;
}

export default function ActionInput({ campaignId }: Props) {
  const router = useRouter();
  const [action, setAction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!action.trim()) return;

    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/campaign/${campaignId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: action.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to submit action.");
        return;
      }

      setAction("");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-2">
        <label htmlFor="action-input" className="sr-only">
          Your action
        </label>
        <input
          id="action-input"
          type="text"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          disabled={submitting}
          maxLength={500}
          placeholder="What do you do?"
          className="flex-1 rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={submitting || !action.trim()}
          className="rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors"
        >
          {submitting ? "…" : "Act"}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400 bg-red-950/40 rounded px-3 py-2">
          {error}
        </p>
      )}
    </form>
  );
}
