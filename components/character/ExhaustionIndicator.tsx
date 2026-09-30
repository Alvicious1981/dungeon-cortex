/**
 * components/character/ExhaustionIndicator.tsx
 *
 * Shows the player the exhaustion level the backend is enforcing and what it
 * costs them, in the game's Spanish.
 *
 * Display only. Which effects apply at which level is decided by
 * `exhaustionEffects` (lib/rules/exhaustion.ts) — the same function every
 * rule asks — so this panel can never disagree with the dice about a
 * threshold. It renders nothing at level 0.
 */

import { exhaustionEffects, MAX_EXHAUSTION_LEVEL } from "@/lib/rules/exhaustion";

export interface ExhaustionIndicatorProps {
  exhaustionLevel: number | null | undefined;
}

/** The effects in force, as short Spanish phrases, from the rule's own flags. */
export function exhaustionEffectLabels(level: number | null | undefined): string[] {
  const effects = exhaustionEffects(level);
  if (effects.level === 0) return [];
  if (effects.dead) return ["Muerte por agotamiento"];

  const labels = ["Desventaja en pruebas de característica"];
  if (effects.speedMultiplier === 0) labels.push("Velocidad 0: no puedes moverte ni viajar");
  else if (effects.speedMultiplier === 0.5) labels.push("Velocidad a la mitad");
  if (effects.attackDisadvantage) labels.push("Desventaja en ataques y tiradas de salvación");
  if (effects.hitPointMaximumHalved) labels.push("Puntos de golpe máximos a la mitad");
  return labels;
}

/**
 * A warning about what the next level would do, when it is severe enough to
 * change a decision: from level 4 two more levels are death, and level 5
 * cannot move or travel until a long rest.
 */
export function exhaustionWarning(level: number | null | undefined): string | null {
  const { level: l, dead } = exhaustionEffects(level);
  if (dead || l < 4) return null;
  if (l === 5) return "Un descanso largo te devuelve al nivel 4 y te permite moverte.";
  return "Cuidado: con dos niveles más mueres. Evita la marcha forzada y haz un descanso largo.";
}

export default function ExhaustionIndicator({ exhaustionLevel }: ExhaustionIndicatorProps) {
  const effects = exhaustionEffects(exhaustionLevel);
  if (effects.level === 0) return null;

  const labels = exhaustionEffectLabels(exhaustionLevel);
  const warning = exhaustionWarning(exhaustionLevel);
  const severe = effects.level >= 4;
  const accent = severe ? "#F87171" : "#FBBF24";

  return (
    <section
      role="status"
      aria-label={`Agotamiento nivel ${effects.level} de ${MAX_EXHAUSTION_LEVEL}`}
      data-testid="exhaustion-indicator"
      data-level={effects.level}
      className="mt-2.5 rounded-md px-3 py-2"
      style={{
        background: severe ? "rgba(127,29,29,0.25)" : "rgba(120,53,15,0.22)",
        border: `1px solid ${severe ? "rgba(248,113,113,0.45)" : "rgba(251,191,36,0.4)"}`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[9px] font-semibold uppercase tracking-[0.2em]"
          style={{ fontFamily: "var(--font-cinzel)", color: accent }}
        >
          Agotamiento
        </span>
        <span className="text-xs font-semibold tabular-nums" style={{ color: accent }}>
          {effects.level} / {MAX_EXHAUSTION_LEVEL}
        </span>
      </div>
      <ul className="mt-1.5 space-y-0.5 text-xs" style={{ color: "#E7D8B8" }}>
        {labels.map((label) => (
          <li key={label}>· {label}</li>
        ))}
      </ul>
      {warning && (
        <p className="mt-1.5 text-[11px] italic" style={{ color: accent }}>
          {warning}
        </p>
      )}
      {!effects.dead && (
        <p className="mt-1 text-[10px]" style={{ color: "#8A7A5A" }}>
          Cada descanso largo reduce un nivel.
        </p>
      )}
    </section>
  );
}
