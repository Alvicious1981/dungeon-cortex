"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RotateCcw, ShieldCheck } from "lucide-react";
import { ABILITY_SCORES, STANDARD_ARRAY, type AbilityScore } from "@/lib/dnd-api/constants";
import type { ApiListItem } from "@/lib/dnd-api/client";

interface Props {
  races: ApiListItem[];
  classes: ApiListItem[];
}

type CreationStep = "idle" | "creating-character" | "creating-campaign" | "campaign-error";

const DEFAULT_STATS: Record<AbilityScore, number> = {
  STR: 15,
  DEX: 14,
  CON: 13,
  INT: 12,
  WIS: 10,
  CHA: 8,
};

const SCORE_BOUNDS = { min: 3, max: 20 };

async function readResponse(response: Response): Promise<{ id?: string; error?: string }> {
  try {
    return (await response.json()) as { id?: string; error?: string };
  } catch {
    return {};
  }
}

export default function CharacterCreationForm({ races, classes }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [race, setRace] = useState(races[0]?.index ?? "");
  const [characterClass, setCharacterClass] = useState(classes[0]?.index ?? "");
  const [stats, setStats] = useState<Record<AbilityScore, number>>(DEFAULT_STATS);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<CreationStep>("idle");
  const [createdCharacterId, setCreatedCharacterId] = useState<string | null>(null);

  const submitting = step === "creating-character" || step === "creating-campaign";
  const characterLocked = createdCharacterId !== null;

  function handleStatChange(ability: AbilityScore, raw: string) {
    const value = Number.parseInt(raw, 10);
    if (Number.isNaN(value)) return;
    setStats((previous) => ({
      ...previous,
      [ability]: Math.min(SCORE_BOUNDS.max, Math.max(SCORE_BOUNDS.min, value)),
    }));
  }

  function resetToStandardArray() {
    const reset = {} as Record<AbilityScore, number>;
    ABILITY_SCORES.forEach((ability, index) => {
      reset[ability] = STANDARD_ARRAY[index];
    });
    setStats(reset);
  }

  async function createCampaign(characterId: string) {
    setStep("creating-campaign");
    const response = await fetch("/api/campaign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId, title: `${name.trim()}'s Chronicle` }),
    });
    const data = await readResponse(response);
    if (!response.ok || !data.id) {
      setStep("campaign-error");
      setError(data.error ?? "Your hero was saved, but the chronicle could not be opened.");
      return;
    }
    router.push(`/campaign/${data.id}`);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      if (createdCharacterId) {
        await createCampaign(createdCharacterId);
        return;
      }

      setStep("creating-character");
      const response = await fetch("/api/character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, race, class: characterClass, stats }),
      });
      const data = await readResponse(response);
      if (!response.ok || !data.id) {
        setStep("idle");
        setError(data.error ?? "The hero could not be created.");
        return;
      }

      setCreatedCharacterId(data.id);
      await createCampaign(data.id);
    } catch {
      setStep(createdCharacterId ? "campaign-error" : "idle");
      setError(
        createdCharacterId
          ? "Your hero is safe, but the chronicle is still unreachable. Try opening it again."
          : "The archive is unreachable. Check your connection and try again."
      );
    }
  }

  const submitLabel =
    step === "creating-character"
      ? "Forging hero…"
      : step === "creating-campaign"
        ? "Opening chronicle…"
        : step === "campaign-error"
          ? "Retry opening chronicle"
          : "Begin Adventure";

  return (
    <form onSubmit={handleSubmit} className="space-y-6" aria-describedby="creation-status">
      <fieldset disabled={submitting || characterLocked} className="space-y-5 disabled:opacity-75">
        <legend className="sr-only">Hero identity</legend>
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[#c8b898]" htmlFor="name">
            Character Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={60}
            autoComplete="off"
            placeholder="e.g. Thorin Ironforge"
            className="dc-field w-full rounded-sm px-3 py-2 text-sm placeholder:text-[#675c4a]"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[#c8b898]" htmlFor="race">Race</label>
            <select id="race" value={race} onChange={(event) => setRace(event.target.value)} className="dc-field w-full rounded-sm px-3 py-2 text-sm">
              {races.map((entry) => <option key={entry.index} value={entry.index}>{entry.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[#c8b898]" htmlFor="class">Class</label>
            <select id="class" value={characterClass} onChange={(event) => setCharacterClass(event.target.value)} className="dc-field w-full rounded-sm px-3 py-2 text-sm">
              {classes.map((entry) => <option key={entry.index} value={entry.index}>{entry.name}</option>)}
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset disabled={submitting || characterLocked} className="m-0 border-0 p-0 disabled:opacity-75">
        <div className="mb-3 flex items-center justify-between gap-4">
          <legend className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c8b898]">Ability Scores</legend>
          <button type="button" onClick={resetToStandardArray} className="inline-flex min-h-11 items-center gap-1.5 text-xs text-amber-300 underline decoration-amber-500/50 underline-offset-4 hover:text-amber-200">
            <RotateCcw aria-hidden="true" size={14} /> Standard array
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {ABILITY_SCORES.map((ability) => {
            const inputId = `ability-${ability.toLowerCase()}`;
            return (
              <div key={ability} className="rounded-sm border border-[#332a45] bg-black/25 p-2 text-center">
                <label htmlFor={inputId} className="mb-1 block font-mono text-[11px] font-bold text-[#a78bfa]">{ability}</label>
                <input id={inputId} aria-label={`${ability} score`} type="number" value={stats[ability]} min={SCORE_BOUNDS.min} max={SCORE_BOUNDS.max} onChange={(event) => handleStatChange(ability, event.target.value)} className="dc-field w-full rounded-sm px-1 py-1 text-center font-mono text-sm" />
              </div>
            );
          })}
        </div>
      </fieldset>

      <div id="creation-status" aria-live="polite" aria-atomic="true">
        {error && (
          <div role="alert" className="rounded-sm border border-red-400/40 bg-red-950/50 px-4 py-3 text-sm text-red-200">
            <p className="font-semibold">The archive resisted.</p>
            <p className="mt-1 text-red-200/80">{error}</p>
          </div>
        )}
        {characterLocked && !error && (
          <p className="flex items-center gap-2 text-sm text-emerald-300"><ShieldCheck aria-hidden="true" size={17} /> Hero saved. Opening the campaign…</p>
        )}
      </div>

      <button type="submit" disabled={submitting} className="dc-button-primary w-full rounded-sm px-4 py-3 text-sm uppercase tracking-[0.12em]">
        {submitting && <LoaderCircle aria-hidden="true" className="mr-2 animate-spin motion-reduce:animate-none" size={18} />}
        {submitLabel}
      </button>
      <p className="text-center text-xs leading-relaxed text-[#8f826d]">Rules, rolls and campaign state remain resolved by Dungeon Cortex.</p>
    </form>
  );
}
