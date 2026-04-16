import { notFound } from "next/navigation";
import Link from "next/link";
import { Cinzel, Crimson_Pro } from "next/font/google";
import { prisma } from "@/lib/db/prisma";
import ActionInput from "./ActionInput";
import MacroDeck from "@/components/combat/MacroDeck";
import InitiativeTracker from "@/components/combat/InitiativeTracker";
import CombatVTT from "@/components/combat/CombatVTT";
import GameEventHandler from "@/components/combat/GameEventHandler";
import ExplorationPanel from "@/components/exploration/ExplorationPanel";
import MemoryJournal from "@/components/MemoryJournal";
import QuestTracker from "@/components/QuestTracker";
import NPCRoster from "@/components/NPCRoster";
import type { InitiativeEntry } from "@/lib/rules/combat";
import type {
  WeaponProperties,
  ArmorProperties,
  ConsumableProperties,
  SpellProperties,
  ItemType,
} from "@/lib/rules/inventory";
import AscensionOverlayController from "@/components/character/AscensionOverlay";
import XPProgressBar from "@/components/character/XPProgressBar";
import TradeOverlayController from "@/components/trade/TradeOverlayController";
import DialogueOverlayController from "@/components/social/DialogueOverlayController";

// ─── Fonts ───────────────────────────────────────────────────────────────────

const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["400", "600", "700", "900"],
  variable: "--font-cinzel",
  display: "swap",
});

const crimsonPro = Crimson_Pro({
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  variable: "--font-crimson",
  display: "swap",
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface CampaignPageProps {
  params: Promise<{ id: string }>;
}

type SpellSlotData = Record<string, { total: number; used: number }>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseSpellSlots(raw: unknown): SpellSlotData | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const hasValidSlot = Object.values(obj).some(
    (v) =>
      v !== null &&
      typeof v === "object" &&
      "total" in (v as object) &&
      typeof (v as { total: unknown }).total === "number"
  );
  return hasValidSlot ? (obj as SpellSlotData) : null;
}

function hpBarColor(hp: number, maxHp: number): string {
  const pct = maxHp > 0 ? hp / maxHp : 1;
  if (pct <= 0.25) return "#EF4444";
  if (pct <= 0.5) return "#F59E0B";
  return "#22C55E";
}

/** Human-readable labels for each equipped gear slot. */
const SLOT_LABELS: Record<string, { label: string; glyph: string }> = {
  MAIN_HAND:  { label: "Main Hand",  glyph: "⚔" },
  OFF_HAND:   { label: "Off Hand",   glyph: "🛡" },
  ARMOR:      { label: "Armor",      glyph: "⛨" },
  ACCESSORY:  { label: "Accessory",  glyph: "◈" },
};

const ITEM_TYPE_STYLE: Record<
  ItemType,
  { label: string; textColor: string; bg: string; glyph: string }
> = {
  weapon:     { label: "WPN", glyph: "⚔", textColor: "#FCA5A5", bg: "rgba(239,68,68,0.15)" },
  armor:      { label: "ARM", glyph: "🛡", textColor: "#93C5FD", bg: "rgba(59,130,246,0.15)" },
  consumable: { label: "CON", glyph: "⚗", textColor: "#86EFAC", bg: "rgba(34,197,94,0.15)" },
  spell:      { label: "SPL", glyph: "✦", textColor: "#C4B5FD", bg: "rgba(139,92,246,0.15)" },
  misc:       { label: "MSC", glyph: "◆", textColor: "#FDE68A", bg: "rgba(245,158,11,0.15)" },
};

function getItemTypeStyle(type: string) {
  return ITEM_TYPE_STYLE[type as ItemType] ?? ITEM_TYPE_STYLE.misc;
}

// Per-type stat line rendered as plain text (no client JS needed).
function itemStatLine(type: string, properties: unknown): string {
  if (!properties || typeof properties !== "object") return "";
  switch (type as ItemType) {
    case "weapon": {
      const p = properties as Partial<WeaponProperties>;
      if (!p.damageDice) return "";
      const bonus =
        p.damageBonus !== undefined && p.damageBonus !== 0
          ? ` ${p.damageBonus > 0 ? "+" : ""}${p.damageBonus}`
          : "";
      return `${p.damageDice}${bonus} ${p.damageType ?? ""}`.trim();
    }
    case "armor": {
      const p = properties as Partial<ArmorProperties>;
      if (p.baseAC === undefined) return "";
      const dex = p.addDexModifier
        ? p.maxDexBonus !== null && p.maxDexBonus !== undefined
          ? ` + DEX (max ${p.maxDexBonus})`
          : " + DEX"
        : "";
      return `AC ${p.baseAC}${dex}`;
    }
    case "consumable": {
      const p = properties as Partial<ConsumableProperties>;
      const parts: string[] = [];
      if (p.healingDice)
        parts.push(`Heals ${p.healingDice}${p.healingBonus ? ` +${p.healingBonus}` : ""}`);
      if (p.effects?.length) parts.push(p.effects.join(", "));
      return parts.join(" · ");
    }
    case "spell": {
      const p = properties as Partial<SpellProperties>;
      const level = p.spellLevel === 0 ? "Cantrip" : `Level ${p.spellLevel ?? "?"}`;
      const dmg = p.damageDice ? ` · ${p.damageDice} ${p.damageType ?? ""}`.trim() : "";
      return `${level}${dmg}`;
    }
    default:
      return "";
  }
}

// ─── Metadata ────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: CampaignPageProps) {
  const { id } = await params;
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  return {
    title: campaign
      ? `${campaign.title} — Dungeon Cortex`
      : "Campaign — Dungeon Cortex",
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function CampaignPage({ params }: CampaignPageProps) {
  const { id } = await params;

  const [campaign, memories, quests, npcs] = await Promise.all([
    prisma.campaign.findUnique({
      where: { id },
      include: {
        character: {
          include: {
            inventory: {
              orderBy: [{ type: "asc" }, { name: "asc" }],
            },
          },
        },
        logs: { orderBy: { createdAt: "asc" } },
        encounters: {
          where: { status: "active" },
          include: {
            combatants: { orderBy: { initiativeTotal: "desc" } },
            zones: true,
          },
        },
      },
    }),
    // Fetch recent consolidated memories for the journal (newest first, no vector column)
    prisma.memoryEntry.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, content: true, importance: true, createdAt: true },
    }),
    // Fetch all quests for this campaign — active first, then completed/failed
    prisma.quest.findMany({
      where: { campaignId: id },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        createdAt: true,
        location: true,
        hook: true,
        objective: true,
        reward: true,
      },
    }),
    // Fetch all known NPCs for this campaign — newest first
    prisma.nPC.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
        race: true,
        profession: true,
        alignment: true,
        hp: true,
        maxHp: true,
        ac: true,
        notes: true,
        abilityScores: true,
        traits: true,
        disposition: true,
        personalityTags: true,
        hasMetPlayer: true,
        seed: true,
      },
    }),
  ]);

  if (!campaign) {
    notFound();
  }

  // ── Exploration data (conditional — only when campaign has an active location) ──
  type ExplorationData = {
    campaignId: string;
    location: { id: string; name: string; type: string; description: string };
    nodes: Array<{ index: number; name: string; description: string; feature: string; npcSeed: string | null; x: number; y: number }>;
    edges: Array<{ fromIndex: number; toIndex: number; passageType: string }>;
    initialCurrentNodeIndex: number;
    initialVisitedNodeIndices: number[];
  } | null;

  let explorationData: ExplorationData = null;
  if (campaign.currentLocationId && campaign.currentNodeId) {
    const loc = await prisma.location.findUnique({
      where: { id: campaign.currentLocationId },
      include: {
        nodes: { orderBy: { index: "asc" } },
        edges: true,
      },
    });
    if (loc) {
      const nodeById = new Map(loc.nodes.map((n) => [n.id, n]));
      const currentNode = loc.nodes.find((n) => n.id === campaign.currentNodeId);
      if (currentNode) {
        explorationData = {
          campaignId: campaign.id,
          location: { id: loc.id, name: loc.name, type: loc.type, description: loc.description },
          nodes: loc.nodes.map((n) => ({
            index: n.index, name: n.name, description: n.description,
            feature: n.feature, npcSeed: n.npcSeed, x: n.x, y: n.y,
          })),
          edges: loc.edges.map((e) => ({
            fromIndex: nodeById.get(e.fromNodeId)?.index ?? 0,
            toIndex:   nodeById.get(e.toNodeId)?.index ?? 0,
            passageType: e.passageType,
          })),
          initialCurrentNodeIndex: currentNode.index,
          initialVisitedNodeIndices: [currentNode.index],
        };
      }
    }
  }

  const { character, logs } = campaign;
  const activeEncounter = campaign.encounters[0] ?? null;

  const spellSlots = parseSpellSlots(character.spellSlots);
  const hpPercent = character.maxHp > 0
    ? Math.max(0, Math.min(100, Math.round((character.hp / character.maxHp) * 100)))
    : 0;

  const initiativeEntries: InitiativeEntry[] = activeEncounter
    ? activeEncounter.combatants.map((c) => ({
        id: c.id,
        name: c.name,
        dexModifier: 0,
        naturalRoll: c.initiativeTotal,
        initiative: c.initiativeTotal,
        roll: {
          notation: "1d20",
          dice: [{ faces: 20, result: c.initiativeTotal }],
          diceTotal: c.initiativeTotal,
          modifier: 0,
          total: c.initiativeTotal,
        },
      }))
    : [];

  const activeCombatantId =
    activeEncounter?.combatants[activeEncounter.currentTurnIndex]?.id;

  const barColor = hpBarColor(character.hp, character.maxHp);

  // Group inventory by type for display
  const TYPE_ORDER: ItemType[] = ["weapon", "armor", "spell", "consumable", "misc"];
  const grouped = TYPE_ORDER.reduce<Record<ItemType, typeof character.inventory>>(
    (acc, t) => {
      acc[t] = character.inventory.filter((i) => i.type === t);
      return acc;
    },
    { weapon: [], armor: [], spell: [], consumable: [], misc: [] }
  );
  const hasInventory = character.inventory.length > 0;

  return (
    <div
      className={`${cinzel.variable} ${crimsonPro.variable} min-h-screen`}
      style={{ background: "#070710", color: "#E2D9C5" }}
    >
      {/* Ascension Overlay — self-wiring, listens for dungeon-level-up events */}
      <AscensionOverlayController />
      {/* Trade Overlay — self-wiring, listens for dungeon-merchant events */}
      <TradeOverlayController campaignId={campaign.id} initialGold={campaign.gold} playerInventory={character.inventory} />
      {/* Dialogue Overlay — self-wiring, listens for dungeon-dialogue-open events */}
      <DialogueOverlayController campaignId={campaign.id} characterId={character.id} />
      {/* Ambient glow — purely decorative */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse 70% 45% at 15% 5%, rgba(110,72,14,0.07) 0%, transparent 55%)," +
            "radial-gradient(ellipse 55% 40% at 85% 95%, rgba(88,60,140,0.06) 0%, transparent 55%)",
        }}
      />

      <main
        className="relative z-10 mx-auto max-w-6xl px-4 py-8 sm:px-6"
        id="main-content"
      >
        {/* ── Skip link (accessibility) ── */}
        <a
          href="#chronicle"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:px-3 focus:py-1.5 focus:text-sm"
          style={{ background: "#F59E0B", color: "#0A0A14" }}
        >
          Skip to chronicle
        </a>

        {/* ════════════════
            HEADER
        ════════════════ */}
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p
              className="mb-1 text-[10px] uppercase tracking-[0.3em]"
              style={{ fontFamily: "var(--font-cinzel)", color: "#C49A2A" }}
            >
              Active Campaign
            </p>
            <h1
              className="text-2xl font-bold leading-tight sm:text-3xl"
              style={{ fontFamily: "var(--font-cinzel)", color: "#E8C84A", letterSpacing: "0.04em" }}
            >
              {campaign.title}
            </h1>
          </div>
          <span
            className="mt-1 inline-flex shrink-0 items-center rounded px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest"
            style={{
              background: "rgba(100,70,14,0.25)",
              border: "1px solid rgba(245,158,11,0.3)",
              color: "#F59E0B",
              fontFamily: "var(--font-cinzel)",
            }}
          >
            {campaign.status}
          </span>
        </header>

        {/* ════════════════
            MAIN GRID
        ════════════════ */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[296px_1fr_256px]">

          {/* ════════════════════════════════════
              LEFT COLUMN — Character Status Panel
          ════════════════════════════════════ */}
          <aside
            className="space-y-4"
            aria-label="Character status"
          >

            {/* ── Identity card ── */}
            <section
              className="rounded-lg p-5 space-y-5"
              style={{
                background: "rgba(12,12,22,0.92)",
                border: "1px solid rgba(228,168,50,0.2)",
                boxShadow: "inset 0 1px 0 rgba(255,220,80,0.05)",
              }}
            >
              {/* Name & class */}
              <div>
                <p
                  className="mb-0.5 text-[10px] uppercase tracking-[0.3em]"
                  style={{ fontFamily: "var(--font-cinzel)", color: "#C49A2A" }}
                >
                  Adventurer
                </p>
                <h2
                  className="text-xl font-bold leading-snug"
                  style={{ fontFamily: "var(--font-cinzel)", color: "#E8C84A" }}
                >
                  {character.name}
                </h2>
                <p
                  className="mt-0.5 text-sm"
                  style={{ fontFamily: "var(--font-crimson)", color: "#C8B898", fontStyle: "italic" }}
                >
                  Level {character.level} {character.race} {character.class}
                </p>

                {/* ── Concentration badge ── */}
                {character.concentrationSpellId && (
                  <div
                    role="status"
                    aria-label="Concentration active"
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
                    style={{
                      background: "rgba(76,29,149,0.25)",
                      border: "1px solid rgba(167,139,250,0.45)",
                      boxShadow: "0 0 12px rgba(139,92,246,0.2), inset 0 1px 0 rgba(196,181,253,0.06)",
                    }}
                  >
                    {/* Pulsing rune dot */}
                    <span
                      aria-hidden="true"
                      className="inline-block h-1.5 w-1.5 rounded-full motion-safe:animate-pulse"
                      style={{
                        background: "#A78BFA",
                        boxShadow: "0 0 6px #7C3AED",
                      }}
                    />
                    <span
                      className="text-[9px] font-semibold uppercase tracking-[0.2em]"
                      style={{ fontFamily: "var(--font-cinzel)", color: "#C4B5FD" }}
                    >
                      Concentrating
                    </span>
                    <span
                      aria-hidden="true"
                      className="text-[10px]"
                      style={{ color: "#7C3AED" }}
                    >
                      ◈
                    </span>
                  </div>
                )}
              </div>

              {/* ── HP bar ── */}
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <span
                    className="text-[10px] uppercase tracking-widest font-semibold"
                    style={{ fontFamily: "var(--font-cinzel)", color: "#C49A2A" }}
                  >
                    Hit Points
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    <span style={{ color: barColor }}>{character.hp}</span>
                    <span style={{ color: "#7A6A50" }}> / {character.maxHp}</span>
                  </span>
                </div>

                {/* Track */}
                <div
                  role="meter"
                  aria-valuenow={character.hp}
                  aria-valuemin={0}
                  aria-valuemax={character.maxHp}
                  aria-label={`Hit points: ${character.hp} of ${character.maxHp}`}
                  className="relative h-3 overflow-hidden rounded-full"
                  style={{
                    background: "rgba(20,14,6,0.9)",
                    border: "1px solid rgba(80,55,14,0.4)",
                  }}
                >
                  <div
                    className="h-full rounded-full motion-safe:transition-all motion-safe:duration-700"
                    style={{
                      width: `${hpPercent}%`,
                      background: `linear-gradient(90deg, ${barColor}AA, ${barColor})`,
                      boxShadow: `0 0 10px ${barColor}55`,
                    }}
                  />
                </div>

                <p
                  className="mt-1 text-right text-[10px] tabular-nums"
                  style={{ color: "#3A3020" }}
                >
                  {hpPercent}%
                </p>
              </div>

              {/* ── XP progress bar ── */}
              <XPProgressBar xp={character.xp} level={character.level} />
            </section>

            {/* ── Spell Slots ── */}
            {spellSlots !== null && (
              <section
                className="rounded-lg p-5 space-y-3"
                aria-label="Spell slots"
                style={{
                  background: "rgba(12,12,22,0.92)",
                  border: "1px solid rgba(99,102,241,0.22)",
                  boxShadow: "inset 0 1px 0 rgba(165,180,252,0.04)",
                }}
              >
                <p
                  className="text-[10px] uppercase tracking-[0.3em]"
                  style={{ fontFamily: "var(--font-cinzel)", color: "#6B63C0" }}
                >
                  Arcane Reserves
                </p>

                <div className="space-y-2.5">
                  {Object.entries(spellSlots)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([level, slot]) => {
                      const available = Math.max(0, slot.total - (slot.used ?? 0));
                      return (
                        <div key={level} className="flex items-center gap-2.5">
                          <span
                            className="w-10 shrink-0 text-[10px] uppercase tracking-widest"
                            style={{ fontFamily: "var(--font-cinzel)", color: "#6B63C0" }}
                          >
                            Lv {level}
                          </span>

                          {/* Crystal orb indicators */}
                          <div
                            className="flex flex-wrap gap-1.5"
                            role="group"
                            aria-label={`Level ${level}: ${available} of ${slot.total} available`}
                          >
                            {Array.from({ length: slot.total }).map((_, i) => {
                              const filled = i < available;
                              return (
                                <span
                                  key={i}
                                  aria-hidden="true"
                                  className="inline-block h-3 w-3 rounded-full"
                                  style={{
                                    background: filled
                                      ? "radial-gradient(circle at 35% 30%, #C4B5FD, #6366F1)"
                                      : "rgba(20,18,40,0.8)",
                                    border: "1px solid",
                                    borderColor: filled
                                      ? "#6366F1"
                                      : "rgba(99,102,241,0.25)",
                                    boxShadow: filled
                                      ? "0 0 6px rgba(99,102,241,0.45)"
                                      : "none",
                                  }}
                                />
                              );
                            })}
                          </div>

                          <span
                            className="ml-auto shrink-0 text-xs tabular-nums"
                            style={{ color: "#4A4870" }}
                          >
                            {available}/{slot.total}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </section>
            )}

            {/* ── Inventory ── */}
            <section
              className="rounded-lg p-5 space-y-3"
              aria-label="Inventory"
              style={{
                background: "rgba(12,12,22,0.92)",
                border: "1px solid rgba(228,168,50,0.14)",
              }}
            >
              <p
                className="text-[10px] uppercase tracking-[0.3em]"
                style={{ fontFamily: "var(--font-cinzel)", color: "#C49A2A" }}
              >
                Carried Items
              </p>

              {!hasInventory ? (
                <p
                  className="text-xs"
                  style={{ fontFamily: "var(--font-crimson)", fontStyle: "italic", color: "#7A6A50" }}
                >
                  Nothing carried.
                </p>
              ) : (
                <div className="space-y-4">
                  {TYPE_ORDER.map((type) => {
                    const group = grouped[type];
                    if (group.length === 0) return null;
                    const ts = getItemTypeStyle(type);
                    return (
                      <div key={type}>
                        <p
                          className="mb-1.5 text-[9px] uppercase tracking-widest font-semibold"
                          style={{ color: ts.textColor, opacity: 0.7, fontFamily: "var(--font-cinzel)" }}
                        >
                          {type === "spell" ? "Spells" : type === "consumable" ? "Consumables" : type === "misc" ? "Misc" : type.charAt(0).toUpperCase() + type.slice(1) + "s"}
                        </p>
                        <ul className="space-y-1" role="list">
                          {group.map((item) => {
                            const statLine = itemStatLine(item.type, item.properties);
                            return (
                              <li
                                key={item.id}
                                className="flex items-start gap-2 rounded px-2 py-1.5"
                                style={{ background: "rgba(255,255,255,0.025)" }}
                              >
                                {/* Type badge */}
                                <span
                                  className="mt-0.5 shrink-0 rounded-sm px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider leading-none"
                                  style={{ color: ts.textColor, background: ts.bg }}
                                >
                                  {ts.label}
                                </span>

                                {/* Name + stat + equipped slot */}
                                <div className="min-w-0 flex-1">
                                  <span
                                    className="block truncate text-sm font-medium"
                                    style={{ color: "#C8B898", fontFamily: "var(--font-crimson)" }}
                                  >
                                    {item.name}
                                  </span>
                                  {statLine && (
                                    <span
                                      className="block truncate text-xs"
                                      style={{ color: "#5A5040", fontFamily: "var(--font-crimson)", fontStyle: "italic" }}
                                    >
                                      {statLine}
                                    </span>
                                  )}
                                  {/* Equipped slot tag */}
                                  {item.equippedSlot && SLOT_LABELS[item.equippedSlot] && (
                                    <span
                                      className="mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5"
                                      style={{
                                        background: "rgba(179,139,45,0.12)",
                                        border: "1px solid rgba(179,139,45,0.35)",
                                        boxShadow: "0 0 6px rgba(179,139,45,0.1)",
                                      }}
                                      aria-label={`Equipped: ${SLOT_LABELS[item.equippedSlot].label}`}
                                    >
                                      <span aria-hidden="true" className="text-[8px]" style={{ color: "#B38B2D" }}>
                                        {SLOT_LABELS[item.equippedSlot].glyph}
                                      </span>
                                      <span
                                        className="text-[8px] font-semibold uppercase tracking-wider"
                                        style={{ fontFamily: "var(--font-cinzel)", color: "#B38B2D" }}
                                      >
                                        {SLOT_LABELS[item.equippedSlot].label}
                                      </span>
                                    </span>
                                  )}
                                </div>

                                {/* Quantity */}
                                {item.quantity > 1 && (
                                  <span
                                    className="shrink-0 text-xs tabular-nums"
                                    style={{ color: "#5A5040" }}
                                  >
                                    ×{item.quantity}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

          </aside>

          {/* ════════════════════════════════════
              CENTRE — Chronicle + Action
          ════════════════════════════════════ */}
          <div className="min-w-0 space-y-5">

            {/* ── Exploration map — visible when campaign has an active location ── */}
            {explorationData && (
              <ExplorationPanel
                campaignId={explorationData.campaignId}
                location={explorationData.location}
                nodes={explorationData.nodes}
                edges={explorationData.edges}
                initialCurrentNodeIndex={explorationData.initialCurrentNodeIndex}
                initialVisitedNodeIndices={explorationData.initialVisitedNodeIndices}
              />
            )}

            {/* ── VTT battle map — only visible during active encounters ── */}
            {activeEncounter && (
              <CombatVTT
                encounter={{
                  id:               activeEncounter.id,
                  round:            activeEncounter.round,
                  currentTurnIndex: activeEncounter.currentTurnIndex,
                  combatants:       activeEncounter.combatants.map((c) => ({
                    id:              c.id,
                    name:            c.name,
                    isPlayer:        c.isPlayer,
                    hp:              c.hp,
                    maxHp:           c.maxHp,
                    ac:              c.ac,
                    initiativeTotal: c.initiativeTotal,
                    zoneId:          c.zoneId ?? null,
                  })),
                  zones: activeEncounter.zones.map((z) => ({
                    id:   z.id,
                    name: z.name,
                    x:    z.x,
                    y:    z.y,
                  })),
                }}
              />
            )}

            <section aria-label="Adventure chronicle" id="chronicle">
              <p
                className="mb-3 text-[10px] uppercase tracking-[0.3em]"
                style={{ fontFamily: "var(--font-cinzel)", color: "#C49A2A" }}
              >
                The Chronicle
              </p>

              {logs.length === 0 ? (
                <div
                  className="rounded-lg p-10 text-center"
                  style={{
                    background: "rgba(12,12,22,0.6)",
                    border: "1px dashed rgba(100,70,14,0.3)",
                  }}
                >
                  <p
                    className="text-sm"
                    style={{ fontFamily: "var(--font-crimson)", fontStyle: "italic", color: "#7A6A50", lineHeight: "1.75" }}
                  >
                    The parchment is blank. The Dungeon Master awaits
                    your first declaration. Speak, and let your legend begin.
                  </p>
                </div>
              ) : (
                <ul className="space-y-3" role="list">
                  {logs.map((log) => {
                    const isDM = log.role === "assistant";
                    const isPlayer = log.role === "user";
                    return (
                      <li
                        key={log.id}
                        className="rounded-lg px-4 py-3"
                        style={
                          isDM
                            ? {
                                background: "rgba(12,12,22,0.92)",
                                border: "1px solid rgba(100,70,14,0.25)",
                                color: "#C8BEA0",
                              }
                            : isPlayer
                            ? {
                                background: "rgba(25,16,3,0.7)",
                                border: "1px solid rgba(228,168,50,0.22)",
                                color: "#E8C84A",
                              }
                            : {
                                background: "rgba(8,8,18,0.6)",
                                border: "1px solid rgba(99,102,241,0.15)",
                                color: "#7872A8",
                              }
                        }
                      >
                        <span
                          className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.2em]"
                          style={{
                            fontFamily: "var(--font-cinzel)",
                            color: isDM ? "#C49A2A" : isPlayer ? "#F59E0B" : "#5B56A0",
                          }}
                        >
                          {isDM ? "Dungeon Master" : isPlayer ? "You" : "System"}
                        </span>
                        <p
                          className="text-sm leading-relaxed"
                          style={{
                            fontFamily: isDM ? "var(--font-crimson)" : "inherit",
                            fontSize: isDM ? "0.9375rem" : "0.875rem",
                            lineHeight: isDM ? "1.75" : "1.6",
                          }}
                        >
                          {log.content}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <MacroDeck campaignId={campaign.id} inCombat={!!activeEncounter} />
            <ActionInput campaignId={campaign.id} />

          </div>

          {/* ════════════════════════════════════
              RIGHT COLUMN — Combat + Memory
          ════════════════════════════════════ */}
          <aside aria-label="Combat tracker, quest log and memory journal" className="space-y-4">
            <InitiativeTracker
              entries={initiativeEntries}
              activeId={activeCombatantId}
              campaignId={campaign.id}
            />
            <QuestTracker quests={quests} />
            <NPCRoster npcs={npcs} />
            <MemoryJournal memories={memories} />
          </aside>

        </div>

        {/* ── Footer nav ── */}
        <nav className="mt-10" aria-label="Page navigation">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded text-xs transition-colors duration-200 hover:text-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
            style={{ color: "#7A6A50" }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M8 2L4 6L8 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Return to Hall of Records
          </Link>
        </nav>

        {/* GameEventHandler renders the mute toggle + wires Web Audio + visual FX */}
        <GameEventHandler inCombat={!!activeEncounter} />

      </main>
    </div>
  );
}
