"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RotateCcw } from "lucide-react";
import {
  ABILITY_SCORES,
  STANDARD_ARRAY,
  type AbilityScore,
} from "@/lib/dnd-api/constants";
import type { ApiListItem } from "@/lib/dnd-api/client";
import { Button } from "@/components/ui/Button";
import { StatusMessage } from "@/components/ui/StatusMessage";

interface Props {
  races: ApiListItem[];
  classes: ApiListItem[];
}

type CreationStep =
  | "idle"
  | "creating-character"
  | "creating-campaign"
  | "campaign-error";

const DEFAULT_STATS: Record<AbilityScore, number> = {
  STR: 15,
  DEX: 14,
  CON: 13,
  INT: 12,
  WIS: 10,
  CHA: 8,
};

const ABILITY_LABELS: Record<AbilityScore, string> = {
  STR: "FUE",
  DEX: "DES",
  CON: "CON",
  INT: "INT",
  WIS: "SAB",
  CHA: "CAR",
};

const ABILITY_NAMES: Record<AbilityScore, string> = {
  STR: "Fuerza",
  DEX: "Destreza",
  CON: "Constitución",
  INT: "Inteligencia",
  WIS: "Sabiduría",
  CHA: "Carisma",
};

const SCORE_BOUNDS = { min: 3, max: 20 };

async function readResponse(
  response: Response
): Promise<{ id?: string; error?: string }> {
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
  const [stats, setStats] =
    useState<Record<AbilityScore, number>>(DEFAULT_STATS);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<CreationStep>("idle");
  const [createdCharacterId, setCreatedCharacterId] = useState<string | null>(
    null
  );

  const submitting =
    step === "creating-character" || step === "creating-campaign";
  const characterLocked = createdCharacterId !== null;

  function handleStatChange(ability: AbilityScore, raw: string) {
    const value = Number.parseInt(raw, 10);
    if (Number.isNaN(value)) return;
    setStats((previous) => ({
      ...previous,
      [ability]: Math.min(
        SCORE_BOUNDS.max,
        Math.max(SCORE_BOUNDS.min, value)
      ),
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
    try {
      const response = await fetch("/api/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId,
          title: `Crónica de ${name.trim()}`,
        }),
      });
      const data = await readResponse(response);
      if (!response.ok || !data.id) {
        setStep("campaign-error");
        setError(
          data.error ??
            "El personaje se ha guardado, pero no se pudo abrir la campaña."
        );
        return;
      }
      router.push(`/campaign/${data.id}`);
    } catch {
      setStep("campaign-error");
      setError(
        "El personaje está a salvo, pero la campaña sigue inaccesible. Inténtalo de nuevo."
      );
    }
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
        body: JSON.stringify({
          name,
          race,
          class: characterClass,
          stats,
        }),
      });
      const data = await readResponse(response);
      if (!response.ok || !data.id) {
        setStep("idle");
        setError(data.error ?? "No se pudo crear el personaje.");
        return;
      }

      setCreatedCharacterId(data.id);
      await createCampaign(data.id);
    } catch {
      setStep("idle");
      setError(
        "No se puede acceder al archivo. Comprueba la conexión e inténtalo de nuevo."
      );
    }
  }

  const submitLabel =
    step === "creating-character"
      ? "Guardando personaje…"
      : step === "creating-campaign"
        ? "Abriendo campaña…"
        : step === "campaign-error"
          ? "Reintentar apertura"
          : "Comenzar aventura";

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-7"
      aria-describedby="creation-help creation-status"
    >
      <fieldset
        disabled={submitting || characterLocked}
        className="space-y-5 disabled:opacity-70"
      >
        <legend className="dc-heading mb-5 text-xl font-semibold">
          Identidad
        </legend>
        <div>
          <label className="dc-label" htmlFor="name">
            Nombre del personaje
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={60}
            autoComplete="off"
            placeholder="Por ejemplo: Mara Veln"
            className="dc-field px-3 py-2.5"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="dc-label" htmlFor="race">
              Linaje
            </label>
            <select
              id="race"
              value={race}
              onChange={(event) => setRace(event.target.value)}
              className="dc-field px-3 py-2.5"
            >
              {races.map((entry) => (
                <option key={entry.index} value={entry.index}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="dc-label" htmlFor="class">
              Clase
            </label>
            <select
              id="class"
              value={characterClass}
              onChange={(event) => setCharacterClass(event.target.value)}
              className="dc-field px-3 py-2.5"
            >
              {classes.map((entry) => (
                <option key={entry.index} value={entry.index}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset
        disabled={submitting || characterLocked}
        className="m-0 border-0 p-0 disabled:opacity-70"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <legend className="dc-heading text-xl font-semibold">
            Características
          </legend>
          <Button
            type="button"
            variant="ghost"
            size="compact"
            onClick={resetToStandardArray}
          >
            <RotateCcw aria-hidden="true" size={16} />
            Restaurar matriz
          </Button>
        </div>
        <p className="dc-help mb-4">
          Usa la matriz estándar 15, 14, 13, 12, 10 y 8. El servidor validará
          los valores al guardar.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {ABILITY_SCORES.map((ability) => {
            const inputId = `ability-${ability.toLowerCase()}`;
            return (
              <div
                key={ability}
                className="rounded-lg border border-[var(--dc-border)] bg-[var(--dc-canvas-soft)] p-2.5 text-center"
              >
                <label
                  htmlFor={inputId}
                  title={ABILITY_NAMES[ability]}
                  className="mb-1.5 block font-mono text-xs font-bold text-[var(--dc-mechanical)]"
                >
                  {ABILITY_LABELS[ability]}
                </label>
                <input
                  id={inputId}
                  aria-label={`Puntuación de ${ABILITY_NAMES[ability]}`}
                  type="number"
                  value={stats[ability]}
                  min={SCORE_BOUNDS.min}
                  max={SCORE_BOUNDS.max}
                  onChange={(event) =>
                    handleStatChange(ability, event.target.value)
                  }
                  className="dc-field px-1 py-2 text-center font-mono"
                />
              </div>
            );
          })}
        </div>
      </fieldset>

      <div id="creation-status" aria-live="polite" aria-atomic="true">
        {error && (
          <StatusMessage tone="error" title="No se pudo completar el proceso">
            {error}
          </StatusMessage>
        )}
        {characterLocked && !error && (
          <StatusMessage tone="success" title="Personaje guardado">
            Abriendo la campaña confirmada por el servidor…
          </StatusMessage>
        )}
      </div>

      <Button type="submit" loading={submitting} className="w-full">
        {submitting && (
          <LoaderCircle
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
            size={18}
          />
        )}
        {submitLabel}
      </Button>
      <p id="creation-help" className="dc-help text-center">
        Dungeon Cortex conserva en el backend las reglas, las tiradas y el
        estado de campaña.
      </p>
    </form>
  );
}
