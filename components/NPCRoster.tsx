/**
 * components/NPCRoster.tsx
 *
 * Server Component — renders the campaign's known NPC roster.
 * Displays: name, role badge, race/profession/alignment identity line,
 * HP bar, AC, ability score grid, and four personality pillars.
 *
 * No client-side JS required.
 */

import { abilityModifier } from "@/lib/rules/dice";

// ─── Types ───────────────────────────────────────────────────────────────────

type NPCRole = "guard" | "bandit" | "commoner";

interface AbilityScores {
  STR: number;
  DEX: number;
  CON: number;
  INT: number;
  WIS: number;
  CHA: number;
}

interface NPCTraits {
  personality: string;
  ideal: string;
  bond: string;
  flaw: string;
}

interface NPC {
  id: string;
  name: string;
  role: string;
  race: string | null;
  profession: string | null;
  alignment: string | null;
  hp: number;
  maxHp: number;
  ac: number;
  notes: string;
  abilityScores: unknown;
  traits: unknown;
}

interface NPCRosterProps {
  npcs: NPC[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ROLE_CONFIG: Record<
  NPCRole,
  { label: string; accentColor: string; bg: string; borderColor: string }
> = {
  guard: {
    label: "Guard",
    accentColor: "#93C5FD",
    bg: "rgba(30,60,100,0.12)",
    borderColor: "rgba(59,130,246,0.22)",
  },
  bandit: {
    label: "Bandit",
    accentColor: "#FCA5A5",
    bg: "rgba(100,20,20,0.12)",
    borderColor: "rgba(239,68,68,0.22)",
  },
  commoner: {
    label: "Commoner",
    accentColor: "#D4A96A",
    bg: "rgba(80,55,20,0.12)",
    borderColor: "rgba(212,169,106,0.22)",
  },
};

function getRoleConfig(role: string) {
  return ROLE_CONFIG[role as NPCRole] ?? ROLE_CONFIG.commoner;
}

const STAT_KEYS: ReadonlyArray<keyof AbilityScores> = [
  "STR", "DEX", "CON", "INT", "WIS", "CHA",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeAbilityScores(raw: unknown): AbilityScores | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const scores = {} as AbilityScores;
  for (const key of STAT_KEYS) {
    if (typeof obj[key] !== "number") return null;
    scores[key] = obj[key] as number;
  }
  return scores;
}

function safeTraits(raw: unknown): NPCTraits | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.personality !== "string" ||
    typeof obj.ideal !== "string" ||
    typeof obj.bond !== "string" ||
    typeof obj.flaw !== "string"
  ) return null;
  return obj as unknown as NPCTraits;
}

function hpColor(hp: number, maxHp: number): string {
  const pct = maxHp > 0 ? hp / maxHp : 1;
  if (pct <= 0.25) return "#EF4444";
  if (pct <= 0.5) return "#F59E0B";
  return "#22C55E";
}

function modStr(score: number): string {
  const mod = abilityModifier(score);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NPCRoster({ npcs }: NPCRosterProps) {
  if (npcs.length === 0) return null;

  return (
    <section
      aria-label="NPC roster"
      className="rounded-lg p-5 space-y-3"
      style={{
        background: "rgba(12,12,22,0.92)",
        border: "1px solid rgba(228,168,50,0.14)",
        boxShadow: "inset 0 1px 0 rgba(255,220,80,0.03)",
      }}
    >
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <h2
          className="text-[10px] uppercase tracking-[0.3em]"
          style={{ fontFamily: "var(--font-cinzel)", color: "#C49A2A" }}
        >
          Known Persons
        </h2>
        <span className="text-[9px] tabular-nums" style={{ color: "#6A5A38" }}>
          {npcs.length} {npcs.length === 1 ? "soul" : "souls"}
        </span>
      </div>

      {/* NPC cards */}
      <ul className="space-y-3" role="list">
        {npcs.map((npc) => (
          <NPCCard key={npc.id} npc={npc} />
        ))}
      </ul>
    </section>
  );
}

// ─── NPC Card ────────────────────────────────────────────────────────────────

function NPCCard({ npc }: { npc: NPC }) {
  const cfg = getRoleConfig(npc.role);
  const abilities = safeAbilityScores(npc.abilityScores);
  const traits = safeTraits(npc.traits);
  const hpPct = npc.maxHp > 0
    ? Math.max(0, Math.min(100, Math.round((npc.hp / npc.maxHp) * 100)))
    : 0;
  const barColor = hpColor(npc.hp, npc.maxHp);

  return (
    <li
      className="rounded px-3 py-3 space-y-2.5"
      style={{ background: cfg.bg, border: `1px solid ${cfg.borderColor}` }}
    >
      {/* ── Name + role badge ── */}
      <div className="flex items-start justify-between gap-2">
        <span
          className="font-semibold leading-snug"
          style={{
            fontFamily: "var(--font-cinzel)",
            color: "#E8C84A",
            fontSize: "0.82rem",
            letterSpacing: "0.03em",
          }}
        >
          {npc.name}
        </span>
        <span
          className="shrink-0 rounded-sm px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider leading-none"
          style={{ color: cfg.accentColor, background: "rgba(0,0,0,0.35)" }}
        >
          {cfg.label}
        </span>
      </div>

      {/* ── Identity line: race · profession · alignment ── */}
      {(npc.race || npc.profession || npc.alignment) && (
        <p
          className="text-[11px] leading-snug"
          style={{
            fontFamily: "var(--font-crimson)",
            fontStyle: "italic",
            color: "#A0906A",
          }}
        >
          {[
            npc.race ? capitalize(npc.race) : null,
            npc.profession ? capitalize(npc.profession) : null,
            npc.alignment ? capitalize(npc.alignment) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {/* ── HP bar + AC ── */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span
              className="shrink-0 text-[9px] uppercase tracking-widest"
              style={{ fontFamily: "var(--font-cinzel)", color: "#6A5A38" }}
            >
              HP
            </span>
            <span className="text-xs tabular-nums" style={{ color: barColor }}>
              {npc.hp}
            </span>
            <span className="text-[10px] tabular-nums" style={{ color: "#3A3020" }}>
              /{npc.maxHp}
            </span>
          </div>

          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold tabular-nums"
            style={{
              fontFamily: "var(--font-cinzel)",
              background: "rgba(0,0,0,0.4)",
              border: "1px solid rgba(228,168,50,0.2)",
              color: "#C49A2A",
            }}
            aria-label={`Armor class ${npc.ac}`}
          >
            AC {npc.ac}
          </span>
        </div>

        {/* HP track */}
        <div
          role="meter"
          aria-valuenow={npc.hp}
          aria-valuemin={0}
          aria-valuemax={npc.maxHp}
          aria-label={`HP: ${npc.hp} of ${npc.maxHp}`}
          className="relative h-1.5 overflow-hidden rounded-full"
          style={{
            background: "rgba(20,14,6,0.9)",
            border: "1px solid rgba(60,40,10,0.3)",
          }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${hpPct}%`,
              background: `linear-gradient(90deg, ${barColor}99, ${barColor})`,
              boxShadow: `0 0 6px ${barColor}44`,
            }}
          />
        </div>
      </div>

      {/* ── Ability scores grid ── */}
      {abilities && (
        <div
          className="grid grid-cols-6 gap-1 pt-0.5"
          role="group"
          aria-label="Ability scores"
        >
          {STAT_KEYS.map((key) => (
            <div
              key={key}
              className="flex flex-col items-center rounded py-1"
              style={{ background: "rgba(0,0,0,0.3)" }}
            >
              <span
                className="text-[8px] font-bold uppercase tracking-wide"
                style={{ fontFamily: "var(--font-cinzel)", color: "#6A5A38" }}
              >
                {key}
              </span>
              <span
                className="text-[11px] font-semibold tabular-nums leading-tight"
                style={{ color: "#C8B898" }}
              >
                {abilities[key]}
              </span>
              <span
                className="text-[9px] tabular-nums"
                style={{ color: "#7A6A50" }}
              >
                {modStr(abilities[key])}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Personality traits ── */}
      {traits && (
        <dl className="space-y-1 pt-0.5">
          <TraitRow label="Manner" value={traits.personality} />
          <TraitRow label="Ideal" value={traits.ideal} />
          <TraitRow label="Bond" value={traits.bond} />
          <TraitRow label="Flaw" value={traits.flaw} />
        </dl>
      )}

      {/* ── DM notes ── */}
      {npc.notes && (
        <p
          className="text-[11px] leading-snug pt-0.5"
          style={{
            fontFamily: "var(--font-crimson)",
            color: "#7A6A50",
            borderTop: "1px solid rgba(228,168,50,0.08)",
            paddingTop: "0.375rem",
          }}
        >
          {npc.notes}
        </p>
      )}
    </li>
  );
}

// ─── Trait Row ───────────────────────────────────────────────────────────────

function TraitRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt
        className="shrink-0 text-[8px] uppercase tracking-widest"
        style={{ fontFamily: "var(--font-cinzel)", color: "#5A4830" }}
      >
        {label}
      </dt>
      <dd
        className="text-[10px] leading-snug"
        style={{ fontFamily: "var(--font-crimson)", fontStyle: "italic", color: "#7A6A50", margin: 0 }}
      >
        {value}
      </dd>
    </div>
  );
}
