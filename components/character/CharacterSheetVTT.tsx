import {
  Activity,
  HeartPulse,
  Shield,
  Swords,
  Target,
  WandSparkles,
  Wind,
} from "lucide-react";
import StatBlock from "./sheet/StatBlock";
import InventoryGrid, { type InventoryGridItem } from "./sheet/InventoryGrid";

export interface CharacterAbilityScore {
  score: number;
  modifier: number;
  proficient?: boolean;
}

export interface CharacterIdentity {
  name: string;
  className: string;
  level: number;
  race: string;
  background?: string;
  alignment?: string;
}

export interface CharacterCoreStats {
  armorClass: number;
  hitPoints: { current: number; max: number };
  initiative: number;
  speedFeet: number;
  proficiencyBonus: number;
  passivePerception: number;
}

export interface CharacterSheetRow {
  label: string;
  value: string | number;
  proficient?: boolean;
}

export interface CharacterAttack {
  id: string;
  name: string;
  bonus: number;
  damage: string;
  traits?: readonly string[];
}

export interface CharacterSpellSlot {
  level: number;
  total: number;
  used: number;
}

export interface CharacterSheetProps {
  identity: CharacterIdentity;
  core: CharacterCoreStats;
  abilities: Readonly<{
    str: CharacterAbilityScore;
    dex: CharacterAbilityScore;
    con: CharacterAbilityScore;
    int: CharacterAbilityScore;
    wis: CharacterAbilityScore;
    cha: CharacterAbilityScore;
  }>;
  savingThrows: readonly CharacterSheetRow[];
  skills: readonly CharacterSheetRow[];
  attacks: readonly CharacterAttack[];
  spellSlots?: readonly CharacterSpellSlot[];
  inventory: readonly InventoryGridItem[];
  notes?: readonly string[];
}

const ABILITY_ORDER: Array<{ key: keyof CharacterSheetProps["abilities"]; label: string }> = [
  { key: "str", label: "STR" },
  { key: "dex", label: "DEX" },
  { key: "con", label: "CON" },
  { key: "int", label: "INT" },
  { key: "wis", label: "WIS" },
  { key: "cha", label: "CHA" },
];

function formatSigned(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

function percentage(current: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
}

function SheetList({
  title,
  rows,
}: {
  title: string;
  rows: readonly CharacterSheetRow[];
}) {
  return (
    <section className="rounded-xl border border-amber-400/20 bg-slate-950/55 p-3 backdrop-blur-xl">
      <p
        className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-200/80"
        style={{ fontFamily: "var(--font-cinzel)" }}
      >
        {title}
      </p>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between rounded-lg bg-white/5 px-2 py-1.5 text-sm">
            <span className="text-amber-100/85">{row.label}</span>
            <span className="inline-flex items-center gap-1 font-semibold text-amber-50">
              {row.proficient && <Target size={12} className="text-emerald-300" aria-hidden="true" />}
              {row.value}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function CharacterSheetVTT({
  identity,
  core,
  abilities,
  savingThrows,
  skills,
  attacks,
  spellSlots = [],
  inventory,
  notes = [],
}: CharacterSheetProps) {
  const hpPercent = percentage(core.hitPoints.current, core.hitPoints.max);

  return (
    <section
      aria-label="Character Sheet VTT"
      className="relative overflow-hidden rounded-2xl border border-amber-300/25 bg-slate-950/65 p-4 text-amber-50 shadow-2xl shadow-black/60 backdrop-blur-xl sm:p-5"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(251,191,36,0.12),transparent_40%),radial-gradient(ellipse_at_bottom_right,rgba(129,140,248,0.1),transparent_45%)]"
      />

      <div className="relative space-y-4">
        <header className="rounded-xl border border-amber-300/25 bg-black/25 p-4">
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.3em] text-amber-200/75"
            style={{ fontFamily: "var(--font-cinzel)" }}
          >
            Adventurer Record
          </p>
          <h2
            className="mt-1 text-2xl font-bold text-amber-100 sm:text-3xl"
            style={{ fontFamily: "var(--font-cinzel)" }}
          >
            {identity.name}
          </h2>
          <p className="mt-1 text-sm text-amber-100/80" style={{ fontFamily: "var(--font-crimson)" }}>
            Level {identity.level} {identity.race} {identity.className}
          </p>
          <p className="text-xs text-amber-100/55" style={{ fontFamily: "var(--font-crimson)" }}>
            {[identity.background, identity.alignment].filter(Boolean).join(" • ") || "No lineage notes"}
          </p>
        </header>

        <section
          aria-label="Core combat metrics"
          className="grid grid-cols-2 gap-2 rounded-xl border border-amber-300/20 bg-black/25 p-3 sm:grid-cols-3 lg:grid-cols-6"
        >
          <div className="rounded-lg bg-white/5 px-2 py-2">
            <p className="text-[10px] uppercase tracking-widest text-amber-200/70">AC</p>
            <p className="mt-1 flex items-center gap-1.5 text-lg font-bold"><Shield size={15} />{core.armorClass}</p>
          </div>
          <div className="rounded-lg bg-white/5 px-2 py-2">
            <p className="text-[10px] uppercase tracking-widest text-amber-200/70">HP</p>
            <p className="mt-1 flex items-center gap-1.5 text-lg font-bold"><HeartPulse size={15} />{core.hitPoints.current}/{core.hitPoints.max}</p>
          </div>
          <div className="rounded-lg bg-white/5 px-2 py-2">
            <p className="text-[10px] uppercase tracking-widest text-amber-200/70">Init</p>
            <p className="mt-1 flex items-center gap-1.5 text-lg font-bold"><Activity size={15} />{formatSigned(core.initiative)}</p>
          </div>
          <div className="rounded-lg bg-white/5 px-2 py-2">
            <p className="text-[10px] uppercase tracking-widest text-amber-200/70">Speed</p>
            <p className="mt-1 flex items-center gap-1.5 text-lg font-bold"><Wind size={15} />{core.speedFeet} ft</p>
          </div>
          <div className="rounded-lg bg-white/5 px-2 py-2">
            <p className="text-[10px] uppercase tracking-widest text-amber-200/70">Prof</p>
            <p className="mt-1 flex items-center gap-1.5 text-lg font-bold"><Target size={15} />{formatSigned(core.proficiencyBonus)}</p>
          </div>
          <div className="rounded-lg bg-white/5 px-2 py-2">
            <p className="text-[10px] uppercase tracking-widest text-amber-200/70">Passive</p>
            <p className="mt-1 flex items-center gap-1.5 text-lg font-bold"><WandSparkles size={15} />{core.passivePerception}</p>
          </div>

          <div className="col-span-2 sm:col-span-3 lg:col-span-6">
            <div className="mt-1 h-2 overflow-hidden rounded-full border border-rose-300/25 bg-black/45">
              <div
                className="h-full rounded-full bg-gradient-to-r from-rose-500/80 via-amber-400/75 to-emerald-400/70"
                style={{ width: `${hpPercent}%` }}
              />
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.1fr_1fr_1.2fr]">
          <section className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
              {ABILITY_ORDER.map(({ key, label }) => {
                const ability = abilities[key];
                return (
                  <StatBlock
                    key={key}
                    label={label}
                    score={ability.score}
                    modifier={ability.modifier}
                    isProficient={ability.proficient}
                  />
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <SheetList title="Saving Throws" rows={savingThrows} />
            <SheetList title="Skills" rows={skills} />

            <section className="rounded-xl border border-amber-400/20 bg-slate-950/55 p-3 backdrop-blur-xl">
              <p
                className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-200/80"
                style={{ fontFamily: "var(--font-cinzel)" }}
              >
                Attacks & Actions
              </p>
              <ul className="space-y-1.5">
                {attacks.map((attack) => (
                  <li key={attack.id} className="rounded-lg bg-white/5 px-2 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-amber-50">
                        <Swords size={13} aria-hidden="true" />
                        {attack.name}
                      </span>
                      <span className="font-semibold text-amber-100/90">{formatSigned(attack.bonus)} to hit</span>
                    </div>
                    <p className="mt-0.5 text-xs text-amber-100/65">
                      {attack.damage}
                      {attack.traits?.length ? ` • ${attack.traits.join(", ")}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </section>

          <section className="space-y-3">
            <section className="rounded-xl border border-amber-400/20 bg-slate-950/55 p-3 backdrop-blur-xl">
              <p
                className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-200/80"
                style={{ fontFamily: "var(--font-cinzel)" }}
              >
                Spell Slots
              </p>
              {spellSlots.length === 0 ? (
                <p className="text-sm text-amber-100/60">No prepared slot data.</p>
              ) : (
                <div className="space-y-2">
                  {spellSlots.map((slot) => {
                    const available = Math.max(0, slot.total - slot.used);
                    return (
                      <div key={slot.level} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5">
                        <span className="w-10 text-xs font-semibold text-amber-100/80">Lv {slot.level}</span>
                        <div className="flex flex-wrap gap-1" aria-label={`Level ${slot.level} slots`}>
                          {Array.from({ length: slot.total }).map((_, index) => (
                            <span
                              key={`${slot.level}-${index}`}
                              className="h-2.5 w-2.5 rounded-full border"
                              style={{
                                background: index < available ? "rgba(167,139,250,0.9)" : "rgba(15,15,30,0.8)",
                                borderColor: index < available ? "rgba(196,181,253,0.8)" : "rgba(196,181,253,0.25)",
                              }}
                            />
                          ))}
                        </div>
                        <span className="ml-auto text-xs tabular-nums text-amber-100/70">{available}/{slot.total}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-amber-400/20 bg-slate-950/55 p-3 backdrop-blur-xl">
              <p
                className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-200/80"
                style={{ fontFamily: "var(--font-cinzel)" }}
              >
                Inventory
              </p>
              <InventoryGrid items={inventory} />
            </section>

            {notes.length > 0 && (
              <section className="rounded-xl border border-amber-400/20 bg-slate-950/55 p-3 backdrop-blur-xl">
                <p
                  className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-200/80"
                  style={{ fontFamily: "var(--font-cinzel)" }}
                >
                  Notes
                </p>
                <ul className="space-y-1.5 text-sm text-amber-100/80">
                  {notes.map((note, index) => (
                    <li key={`${note}-${index}`} className="rounded-lg bg-white/5 px-2 py-1.5">
                      {note}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
