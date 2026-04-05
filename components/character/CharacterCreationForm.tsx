"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ABILITY_SCORES, STANDARD_ARRAY, type AbilityScore } from "@/lib/dnd-api/constants";
import type { ApiListItem } from "@/lib/dnd-api/client";

interface Props {
  races: ApiListItem[];
  classes: ApiListItem[];
}

const DEFAULT_STATS: Record<AbilityScore, number> = {
  STR: 15,
  DEX: 14,
  CON: 13,
  INT: 12,
  WIS: 10,
  CHA: 8,
};

const SCORE_BOUNDS = { min: 3, max: 20 };

export default function CharacterCreationForm({ races, classes }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [race, setRace] = useState(races[0]?.index ?? "");
  const [characterClass, setCharacterClass] = useState(classes[0]?.index ?? "");
  const [stats, setStats] = useState<Record<AbilityScore, number>>(DEFAULT_STATS);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleStatChange(ability: AbilityScore, raw: string) {
    const value = parseInt(raw, 10);
    if (isNaN(value)) return;
    setStats((prev) => ({
      ...prev,
      [ability]: Math.min(SCORE_BOUNDS.max, Math.max(SCORE_BOUNDS.min, value)),
    }));
  }

  function resetToStandardArray() {
    const reset = {} as Record<AbilityScore, number>;
    ABILITY_SCORES.forEach((ab, i) => {
      reset[ab] = STANDARD_ARRAY[i];
    });
    setStats(reset);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, race, class: characterClass, stats }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create character.");
        return;
      }

      router.push(`/campaign/new?characterId=${data.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Name */}
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="name">
          Character Name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={60}
          placeholder="e.g. Thorin Ironforge"
          className="w-full rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
      </div>

      {/* Race */}
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="race">
          Race
        </label>
        <select
          id="race"
          value={race}
          onChange={(e) => setRace(e.target.value)}
          className="w-full rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          {races.map((r) => (
            <option key={r.index} value={r.index}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      {/* Class */}
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="class">
          Class
        </label>
        <select
          id="class"
          value={characterClass}
          onChange={(e) => setCharacterClass(e.target.value)}
          className="w-full rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          {classes.map((c) => (
            <option key={c.index} value={c.index}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Ability Scores */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Ability Scores</span>
          <button
            type="button"
            onClick={resetToStandardArray}
            className="text-xs text-amber-400 hover:text-amber-300 underline"
          >
            Reset to standard array
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {ABILITY_SCORES.map((ab) => (
            <div key={ab} className="flex flex-col items-center gap-1">
              <label className="text-xs text-neutral-400 font-mono">{ab}</label>
              <input
                type="number"
                value={stats[ab]}
                min={SCORE_BOUNDS.min}
                max={SCORE_BOUNDS.max}
                onChange={(e) => handleStatChange(ab, e.target.value)}
                className="w-full rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm text-center text-neutral-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <p role="alert" className="text-sm text-red-400 bg-red-950/40 rounded px-3 py-2">
          {error}
        </p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-colors"
      >
        {submitting ? "Creating character…" : "Begin Adventure"}
      </button>
    </form>
  );
}
