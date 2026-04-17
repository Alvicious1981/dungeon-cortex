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
      className="relative overflow-hidden rounded-xl border border-amber-400/20 bg-slate-950/55 p-3 backdrop-blur-xl"
      aria-label={`${label} ability score`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-300/10 via-transparent to-indigo-300/10"
      />

      <div className="relative flex items-start justify-between">
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-200/80"
          style={{ fontFamily: "var(--font-cinzel)" }}
        >
          {label}
        </p>
        {isProficient && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-300"
            aria-label={`${label} proficiency enabled`}
          >
            <ShieldCheck size={10} aria-hidden="true" />
            Prof
          </span>
        )}
      </div>

      <div className="relative mt-3 flex items-end justify-between">
        <span
          className="text-3xl font-bold leading-none text-amber-100"
          style={{ fontFamily: "var(--font-cinzel)" }}
        >
          {score}
        </span>
        <span
          className="rounded-md border border-amber-300/30 bg-amber-400/10 px-2 py-1 text-sm font-semibold text-amber-100"
          style={{ fontFamily: "var(--font-cinzel)" }}
        >
          {formatModifier(modifier)}
        </span>
      </div>
    </article>
  );
}
