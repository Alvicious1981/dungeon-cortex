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
  speedFeet: number | null;
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
  { key: "str", label: "Fuerza" },
  { key: "dex", label: "Destreza" },
  { key: "con", label: "Constitución" },
  { key: "int", label: "Inteligencia" },
  { key: "wis", label: "Sabiduría" },
  { key: "cha", label: "Carisma" },
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
  columns = 1,
}: {
  title: string;
  rows: readonly CharacterSheetRow[];
  columns?: 1 | 2;
}) {
  return (
    <section className="rounded-xl border border-[var(--dc-border)] bg-[var(--dc-surface)] p-3 backdrop-blur-xl">
      <p
        className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--dc-text-muted)]"
        style={{ fontFamily: "var(--font-cinzel)" }}
      >
        {title}
      </p>
      <ul className={columns === 2 ? "grid grid-cols-1 gap-1.5 sm:grid-cols-2" : "space-y-1.5"}>
        {rows.map((row) => (
          <li
            key={row.label}
            className="flex items-center justify-between rounded-lg bg-[var(--dc-surface-raised)] px-2 py-1.5 text-sm"
          >
            <span className="truncate pr-1 text-[var(--dc-text-muted)]" title={row.label}>
              {row.label}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-[var(--dc-text)]">
              {row.proficient && (
                <Target size={12} className="text-[var(--dc-success)]" aria-hidden="true" />
              )}
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
      aria-label="Ficha de personaje"
      className="relative overflow-hidden rounded-2xl border border-[var(--dc-border)] bg-[var(--dc-surface)] p-4 text-[var(--dc-text)] shadow-2xl shadow-black/60 backdrop-blur-xl sm:p-5"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(215,138,58,0.08),transparent_40%),radial-gradient(ellipse_at_bottom_right,rgba(139,184,232,0.06),transparent_45%)]"
      />

      <div className="relative space-y-4">
        {/* Encabezado de identidad */}
        <header className="rounded-xl border border-[var(--dc-border)] bg-[var(--dc-surface-raised)] p-4">
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--dc-text-muted)]"
            style={{ fontFamily: "var(--font-cinzel)" }}
          >
            Ficha de aventurero
          </p>
          <h2
            className="mt-1 text-2xl font-bold text-[var(--dc-text)] sm:text-3xl"
            style={{ fontFamily: "var(--font-cinzel)" }}
          >
            {identity.name}
          </h2>
          <p className="mt-1 text-sm text-[var(--dc-text)]" style={{ fontFamily: "var(--font-crimson)" }}>
            Nivel {identity.level} {identity.race} {identity.className}
          </p>
          <p className="text-xs text-[var(--dc-text-muted)]" style={{ fontFamily: "var(--font-crimson)" }}>
            {[identity.background, identity.alignment].filter(Boolean).join(" • ") || "Sin datos de trasfondo"}
          </p>
        </header>

        {/* Estadísticas de combate y métricas esenciales */}
        <section
          aria-label="Estadísticas de combate"
          className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--dc-border)] bg-[var(--dc-surface-raised)] p-3 sm:grid-cols-3 lg:grid-cols-6"
        >
          <div className="rounded-lg bg-[var(--dc-surface)] px-2 py-2 border border-[var(--dc-border)]">
            <p className="text-[10px] uppercase tracking-widest text-[var(--dc-text-muted)]">CA</p>
            <p className="mt-1 flex items-center gap-1.5 text-lg font-bold text-[var(--dc-text)]">
              <Shield size={15} className="text-[var(--dc-mechanical)]" aria-hidden="true" />
              {core.armorClass}
            </p>
          </div>
          <div className="rounded-lg bg-[var(--dc-surface)] px-2 py-2 border border-[var(--dc-border)]">
            <p className="text-[10px] uppercase tracking-widest text-[var(--dc-text-muted)]">PG</p>
            <p className="mt-1 flex items-center gap-1.5 text-lg font-bold text-[var(--dc-text)]">
              <HeartPulse size={15} className="text-rose-400" aria-hidden="true" />
              {core.hitPoints.current}/{core.hitPoints.max}
            </p>
          </div>
          <div className="rounded-lg bg-[var(--dc-surface)] px-2 py-2 border border-[var(--dc-border)]">
            <p className="text-[10px] uppercase tracking-widest text-[var(--dc-text-muted)]">Iniciativa</p>
            <p className="mt-1 flex items-center gap-1.5 text-lg font-bold text-[var(--dc-text)]">
              <Activity size={15} className="text-[var(--dc-action)]" aria-hidden="true" />
              {formatSigned(core.initiative)}
            </p>
          </div>
          <div className="rounded-lg bg-[var(--dc-surface)] px-2 py-2 border border-[var(--dc-border)]">
            <p className="text-[10px] uppercase tracking-widest text-[var(--dc-text-muted)]">Velocidad</p>
            <p className="mt-1 flex items-center gap-1.5 text-lg font-bold text-[var(--dc-text)]">
              <Wind size={15} className="text-[var(--dc-mechanical)]" aria-hidden="true" />
              {core.speedFeet === null ? "N/D" : `${core.speedFeet} pies`}
            </p>
          </div>
          <div className="rounded-lg bg-[var(--dc-surface)] px-2 py-2 border border-[var(--dc-border)]">
            <p className="text-[10px] uppercase tracking-widest text-[var(--dc-text-muted)]">Competencia</p>
            <p className="mt-1 flex items-center gap-1.5 text-lg font-bold text-[var(--dc-text)]">
              <Target size={15} className="text-[var(--dc-success)]" aria-hidden="true" />
              {formatSigned(core.proficiencyBonus)}
            </p>
          </div>
          <div className="rounded-lg bg-[var(--dc-surface)] px-2 py-2 border border-[var(--dc-border)]">
            <p className="text-[10px] uppercase tracking-widest text-[var(--dc-text-muted)]">Percepción pasiva</p>
            <p className="mt-1 flex items-center gap-1.5 text-lg font-bold text-[var(--dc-text)]">
              <WandSparkles size={15} className="text-violet-400" aria-hidden="true" />
              {core.passivePerception}
            </p>
          </div>

          <div className="col-span-2 sm:col-span-3 lg:col-span-6">
            <div className="mt-1 h-2 overflow-hidden rounded-full border border-[var(--dc-border)] bg-[var(--dc-canvas)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-rose-500/80 via-[var(--dc-warning)]/80 to-[var(--dc-success)]/80"
                style={{ width: `${hpPercent}%` }}
              />
            </div>
          </div>
        </section>

        {/* Estructura modular reorganizada de 3 columnas (12 columnas responsive) */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Columna Izquierda: Características y Salvaciones */}
          <section className="space-y-4 lg:col-span-3">
            <div className="grid grid-cols-2 gap-2">
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
            <SheetList title="Salvaciones" rows={savingThrows} />
          </section>

          {/* Columna Central: Ataques, Acciones y Habilidades */}
          <section className="space-y-4 lg:col-span-5">
            {/* Ataques y acciones */}
            <section className="rounded-xl border border-[var(--dc-border)] bg-[var(--dc-surface)] p-3 backdrop-blur-xl">
              <p
                className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--dc-text-muted)]"
                style={{ fontFamily: "var(--font-cinzel)" }}
              >
                Ataques y acciones
              </p>
              {attacks.length === 0 ? (
                <p className="text-sm text-[var(--dc-text-muted)]">Sin ataques equipados.</p>
              ) : (
                <ul className="space-y-1.5">
                  {attacks.map((attack) => (
                    <li
                      key={attack.id}
                      className="rounded-lg bg-[var(--dc-surface-raised)] border border-[var(--dc-border)] px-3 py-2 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--dc-text)]">
                          <Swords size={13} className="text-[var(--dc-action)]" aria-hidden="true" />
                          {attack.name}
                        </span>
                        <span className="font-semibold text-[var(--dc-text)]">
                          {formatSigned(attack.bonus)} al ataque
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--dc-text-muted)]">
                        {attack.damage}
                        {attack.traits?.length ? ` • ${attack.traits.join(", ")}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Habilidades en 2 columnas para legibilidad óptima de las 18 destrezas */}
            <SheetList title="Habilidades" rows={skills} columns={2} />
          </section>

          {/* Columna Derecha: Magia, Inventario y Rasgos/Notas */}
          <section className="space-y-4 lg:col-span-4">
            {/* Espacios de conjuro */}
            <section className="rounded-xl border border-[var(--dc-border)] bg-[var(--dc-surface)] p-3 backdrop-blur-xl">
              <p
                className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--dc-text-muted)]"
                style={{ fontFamily: "var(--font-cinzel)" }}
              >
                Espacios de conjuro
              </p>
              {spellSlots.length === 0 ? (
                <p className="text-sm text-[var(--dc-text-muted)]">Sin datos de espacios de conjuro.</p>
              ) : (
                <div className="space-y-2">
                  {spellSlots.map((slot) => {
                    const available = Math.max(0, slot.total - slot.used);
                    return (
                      <div
                        key={slot.level}
                        className="flex items-center gap-2 rounded-lg bg-[var(--dc-surface-raised)] px-2 py-1.5 border border-[var(--dc-border)]"
                      >
                        <span className="w-12 text-xs font-semibold text-[var(--dc-text-muted)]">
                          Niv. {slot.level}
                        </span>
                        <div
                          className="flex flex-wrap gap-1"
                          aria-label={`Espacios de nivel ${slot.level}`}
                        >
                          {Array.from({ length: slot.total }).map((_, index) => (
                            <span
                              key={`${slot.level}-${index}`}
                              className="h-2.5 w-2.5 rounded-full border"
                              style={{
                                background:
                                  index < available
                                    ? "var(--dc-mechanical)"
                                    : "var(--dc-canvas)",
                                borderColor:
                                  index < available
                                    ? "var(--dc-mechanical)"
                                    : "var(--dc-border)",
                              }}
                            />
                          ))}
                        </div>
                        <span className="ml-auto text-xs tabular-nums text-[var(--dc-text-muted)]">
                          {available}/{slot.total}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Inventario */}
            <section className="rounded-xl border border-[var(--dc-border)] bg-[var(--dc-surface)] p-3 backdrop-blur-xl">
              <p
                className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--dc-text-muted)]"
                style={{ fontFamily: "var(--font-cinzel)" }}
              >
                Inventario
              </p>
              <InventoryGrid items={inventory} />
            </section>

            {/* Rasgos, Idiomas y Notas */}
            {notes.length > 0 && (
              <section className="rounded-xl border border-[var(--dc-border)] bg-[var(--dc-surface)] p-3 backdrop-blur-xl">
                <p
                  className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--dc-text-muted)]"
                  style={{ fontFamily: "var(--font-cinzel)" }}
                >
                  Rasgos, Idiomas y Notas
                </p>
                <ul className="space-y-1.5 text-sm text-[var(--dc-text)]">
                  {notes.map((note, index) => {
                    const isFeature = note.startsWith("Rasgo: ");
                    const isFeat = note.startsWith("Dote: ");
                    const isLanguage = note.startsWith("Idiomas: ");
                    const badgeLabel = isFeature
                      ? "Rasgo"
                      : isFeat
                        ? "Dote"
                        : isLanguage
                          ? "Idioma"
                          : null;
                    const textContent = badgeLabel
                      ? note.slice(note.indexOf(":") + 2)
                      : note;

                    return (
                      <li
                        key={`${note}-${index}`}
                        className="rounded-lg bg-[var(--dc-surface-raised)] border border-[var(--dc-border)] px-2.5 py-1.5"
                      >
                        {badgeLabel ? (
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--dc-action)]">
                              {badgeLabel}:
                            </span>
                            <span className="text-xs text-[var(--dc-text)]">
                              {textContent}
                            </span>
                          </div>
                        ) : (
                          <span>{note}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
