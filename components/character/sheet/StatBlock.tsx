import { ShieldCheck } from "lucide-react";

export interface StatBlockProps {
  label: string;
  score: number;
  modifier: number;
  isProficient?: boolean;
}

function formatModifier(modifier: number): string {
  return modifier >= 0 ? `+${modifier}` : `${modifier}`;
}

export default function StatBlock({
  label,
  score,
  modifier,
  isProficient = false,
}: StatBlockProps) {
  return (
    <article
      className="relative overflow-hidden rounded-xl border border-[var(--dc-border)] bg-[var(--dc-surface)] p-3 backdrop-blur-xl"
      aria-label={`Puntuación de ${label}`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-300/5 via-transparent to-indigo-300/5"
      />

      <div className="relative flex items-start justify-between">
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--dc-text-muted)]"
          style={{ fontFamily: "var(--font-cinzel)" }}
        >
          {label}
        </p>
        {isProficient && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--dc-success)]"
            aria-label={`Competencia en ${label}`}
          >
            <ShieldCheck size={10} aria-hidden="true" />
            Comp.
          </span>
        )}
      </div>

      <div className="relative mt-3 flex items-end justify-between">
        <span
          className="text-3xl font-bold leading-none text-[var(--dc-text)]"
          style={{ fontFamily: "var(--font-cinzel)" }}
        >
          {score}
        </span>
        <span
          className="rounded-md border border-[var(--dc-border)] bg-[var(--dc-surface-raised)] px-2 py-1 text-sm font-semibold text-[var(--dc-text)]"
          style={{ fontFamily: "var(--font-cinzel)" }}
        >
          {formatModifier(modifier)}
        </span>
      </div>
    </article>
  );
}
