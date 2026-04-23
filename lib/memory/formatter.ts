/**
 * lib/memory/formatter.ts
 *
 * Prompt formatting for Milestone D — Memory and continuity.
 *
 * Takes a CampaignContext snapshot and returns a markdown-formatted string
 * suitable for prepending to the AI DM's system instructions. The output
 * gives the model an accurate, up-to-date picture of:
 *   - Character state (HP, spell slots, inventory)
 *   - Active encounter (combatants, initiative order, current turn)
 *   - Recent session events (last few log entries)
 *
 * This module is pure: it performs no I/O and never mutates anything.
 */

import type { CampaignContext, ContextExploration } from "@/lib/memory/context";
import type { Monster } from "@/lib/rules/srd";
import { isSpellSlots } from "@/lib/rules/magic";
import { xpForLevel, MAX_LEVEL, HIT_DIE_MAP } from "@/lib/rules/progression";
import type { CharacterClass } from "@/lib/rules/proficiency";
import { type NPCPersonality, type DispositionBand } from "@/lib/rules/social";
import { getDispositionBand } from "@/lib/rules/social-logic";
import { REST_INTERVAL_TURNS, TURNS_PER_HOUR } from "@/lib/rules/exploration";
import { WATCHES_PER_DAY } from "@/lib/rules/wilderness";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely extracts string[] from the raw JSON conditions field. */
function extractConditions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === "string");
}

/** Maps GameLog role values to human-readable labels for the DM prompt. */
function roleLabel(role: string): string {
  switch (role) {
    case "user":      return "Player";
    case "assistant": return "DM";
    case "system":    return "System";
    default:          return role;
  }
}

/**
 * Truncates a string to `maxLen` characters, appending "…" if cut.
 * Keeps the prompt compact when log entries are long.
 */
function truncate(text: string, maxLen = 200): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 1) + "…";
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

/**
 * Returns the AI DM's immutable persona and operating constraints.
 * These "Iron Laws" are injected first so the model's frame is established
 * before it reads any game-state context.
 *
 * @pure — no parameters, no side effects, constant output.
 */
function formatIronLaws(): string {
  return [
    "## Iron Laws — Referee Persona",
    "You are an impartial, neutral referee simulating a lethal, persistent fantasy world.",
    "You are **NOT** a helpful assistant or a novel writer.",
    "",
    "**Tone:** Dark, serious, visceral, and brief. No embellishment. No comfort.",
    "",
    "**Code is Law / State is Truth:** You have **no mechanical authority**.",
    "Never invent rolls, damage, loot, XP, movement outcomes, social outcomes, weather, or economy changes.",
    "Narrate only mechanics that come from tool outputs or persisted state in this prompt.",
    "",
    "**Tooling Protocol:** Tool descriptions are the canonical action procedures.",
    "When a player action implies a mechanic, call the relevant tool first, then narrate only its returned result.",
    "",
    "**Lookup Accuracy:** For spells, items, and monsters, use lookup tools before narrating mechanics.",
    "Never invent AC, HP, damage, or feature text.",
    "",
    "**Continuity:** Keep narration tightly grounded in current state, recent events, and scene context.",
    `Wilderness day structure is fixed at ${WATCHES_PER_DAY} watches.`,
  ].join("\n");
}

function formatCharacter(character: CampaignContext["character"]): string {
  const lines: string[] = [];

  lines.push("## Character State");
  lines.push(
    `**${character.name}** — ${character.race} ${character.class}, Level ${character.level}`
  );
  lines.push(`**HP:** ${character.hp} / ${character.maxHp}`);

  // XP progress — show next threshold so the AI knows how close a level-up is.
  if (character.level < MAX_LEVEL) {
    const nextThreshold = xpForLevel(character.level + 1);
    lines.push(`**XP:** ${character.xp} / ${nextThreshold} (next level)`);
  } else {
    lines.push(`**XP:** ${character.xp} (Level 20 — max)`);
  }

  // Hit dice — remaining / total for short-rest healing context.
  const hitDieSize = HIT_DIE_MAP[character.class as CharacterClass] ?? "?";
  lines.push(
    `**Hit Dice:** ${character.hitDiceRemaining}/${character.hitDiceTotal} d${hitDieSize}`
  );

  // Spell slots — only shown for characters with spellcasting ability
  const slots = character.spellSlots;
  if (isSpellSlots(slots)) {
    const slotSummary = Object.entries(slots)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([level, entry]) => `L${level}: ${entry?.current ?? 0}/${entry?.max ?? 0}`)
      .join("  |  ");
    lines.push(`**Spell Slots:** ${slotSummary}`);
  }

  // Inventory
  if (character.inventory.length === 0) {
    lines.push("**Inventory:** (empty)");
  } else {
    lines.push("**Inventory:**");
    for (const item of character.inventory) {
      const qty = item.quantity > 1 ? ` ×${item.quantity}` : "";
      lines.push(`- ${item.name}${qty} *(${item.type})*`);
    }
  }

  return lines.join("\n");
}

function formatEncounter(encounter: CampaignContext["activeEncounter"]): string {
  if (!encounter) {
    return "## Combat\nNo active encounter.";
  }

  // Victory trigger — injected when encounter resolves with all enemies dead.
  // The AI MUST call `generateLoot` before narrating any treasure.
  if (encounter.status === "resolved" && encounter.reason === "all_enemies_dead") {
    const tensionDisplay =
      encounter.tensionScore != null ? encounter.tensionScore.toFixed(2) : "unknown";
    return [
      "## ⚔️ VICTORY — Encounter Resolved",
      `All enemies have been defeated. Tension Score at encounter end: **${tensionDisplay}**`,
      "",
      `**MANDATORY:** Call \`generateLoot\` with encounterId \`${encounter.id}\` and tensionScore \`${tensionDisplay}\` NOW.`,
      "Do NOT narrate any loot or treasure until you have the tool response.",
      "",
      "**Then call `awardXP`** with the combat XP for this encounter. " +
      "Compute the total from the defeated enemies' Challenge Ratings using the CR/XP table (DMG p. 275).",
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push("## Combat");
  lines.push(`**Round:** ${encounter.round}`);

  lines.push("**Initiative Order:**");
  encounter.combatants.forEach((combatant, index) => {
    const isCurrent = index === encounter.currentTurnIndex;
    const turnMarker = isCurrent ? " ◀ CURRENT TURN" : "";
    const conditions = extractConditions(combatant.conditions);
    const conditionText = conditions.length > 0 ? ` [${conditions.join(", ")}]` : "";
    const tag = combatant.isPlayer ? "(Player)" : "(Enemy)";

    let mechanicalSummary = "";
    if (!combatant.isPlayer && combatant.stats) {
      const m = combatant.stats as unknown as Monster;
      const ac = m.armor_class?.[0]?.value ?? combatant.ac;
      const constraints: string[] = [];
      if (m.damage_immunities?.length) constraints.push(`Immune: ${m.damage_immunities.join(", ")}`);
      if (m.damage_resistances?.length) constraints.push(`Resist: ${m.damage_resistances.join(", ")}`);
      if (m.condition_immunities?.length) constraints.push(`Cond Immune: ${m.condition_immunities.map((c: any) => typeof c === "string" ? c : c.name).join(", ")}`);
      const constraintStr = constraints.length > 0 ? ` | ${constraints.join(" | ")}` : "";
      mechanicalSummary = `AC: ${ac}${constraintStr}, `;
    } else {
      mechanicalSummary = `AC: ${combatant.ac}, `;
    }

    lines.push(
      `${index + 1}. **${combatant.name}** ${tag} — ${mechanicalSummary}HP: ${combatant.hp}/${combatant.maxHp}, Initiative: ${combatant.initiativeTotal}${conditionText}${turnMarker}`
    );
  });

  return lines.join("\n");
}

/**
 * Returns a "## Long-Term Memory" section populated with past consolidated
 * memories relevant to the current player action.
 *
 * Empty-array guard: returns an empty string (not a header) when `memories`
 * has no entries, so the section is completely absent from the prompt and
 * wastes no context tokens.
 *
 * @pure — no side effects, deterministic output for the same input.
 */
function formatMemories(memories: CampaignContext["relevantMemories"]): string {
  if (memories.length === 0) return "";
  return "## Long-Term Memory\n" + memories.join("\n---\n");
}

function formatRecentLogs(logs: CampaignContext["recentLogs"]): string {
  if (logs.length === 0) {
    return "## Recent Events\n*(No events recorded yet.)*";
  }

  const lines: string[] = [];
  lines.push("## Recent Events");
  for (const log of logs) {
    lines.push(`**${roleLabel(log.role)}:** ${truncate(log.content)}`);
  }

  return lines.join("\n");
}

/**
 * Returns a "## Active Quests" section listing every non-completed/non-failed
 * quest, followed by a "## Completed / Failed Quests" section for resolved ones.
 *
 * The AI DM must treat quest status as canonical. It may ONLY update quest
 * status by calling the `updateQuestStatus` tool — never by narrating a
 * completion without the corresponding state mutation.
 *
 * Empty-section guard: returns an empty string when there are no quests at all,
 * so the section is absent and wastes no context tokens.
 *
 * @pure — no side effects, deterministic output for the same input.
 */
function formatQuests(quests: CampaignContext["quests"]): string {
  if (quests.length === 0) return "";

  const active = quests.filter((q) => q.status === "active");
  const resolved = quests.filter((q) => q.status !== "active");

  const lines: string[] = [];

  if (active.length > 0) {
    lines.push("## Active Quests");
    for (const q of active) {
      lines.push(`- **[${q.id}]** ${q.title}: ${q.description}`);
    }
  }

  if (resolved.length > 0) {
    lines.push("## Completed / Failed Quests");
    for (const q of resolved) {
      const label = q.status === "completed" ? "✓ Completed" : "✗ Failed";
      lines.push(`- **${label}** ${q.title}`);
    }
  }

  return lines.join("\n");
}

/**
 * Returns a "## Merchant" section detailing the currently active merchant's wares.
 *
 * @pure
 */
export function formatShopNode(merchantPayload: any, partyGold: number): string {
  if (!merchantPayload) return "";

  const label = "label" in merchantPayload ? merchantPayload.label : merchantPayload.archetype;

  const lines: string[] = [];
  lines.push(`## 🏪 Merchant: ${merchantPayload.name} — ${label}`);
  lines.push(`${merchantPayload.greeting}`);
  lines.push("");
  lines.push("**Available Wares:**");
  lines.push("| # | Item | Type | Rarity | Buy Price |");
  lines.push("|---|------|------|--------|-----------|");

  for (const item of merchantPayload.inventory) {
    lines.push(`| ${item.index} | ${item.name} | ${item.type} | ${item.rarity} | ${item.buyPriceGP} GP |`);
  }

  lines.push("");
  lines.push(`**Sell Modifier:** ${Math.round(merchantPayload.sellModifier * 100)}% of item value`);
  lines.push(`**Party Gold:** ${partyGold} GP`);
  lines.push("");
  lines.push("To BUY: call `executeTrade` with action \"buy\", itemIndex, quantity.");
  lines.push("To SELL: call `executeTrade` with action \"sell\", inventoryItemId, quantity.");

  return lines.join("\n");
}

/**
 * Returns a "## Exploration" section for the AI system prompt.
 *
 * When an exploration is active, injects the current location, room, feature,
 * NPC seed, and a list of available exits with passage types. This gives the
 * AI a complete, accurate picture of spatial context without hallucination.
 *
 * @pure — no side effects, deterministic output for the same input.
 */
function formatExploration(exploration: ContextExploration | null, partyGold: number = 0): string {
  if (!exploration?.location) {
    return "";
  }

  const { location, currentNode, adjacentNodes, visitedNodeIndices } = exploration;
  const lines: string[] = [];

  lines.push(`## Current Exploration: ${location.name} (${location.type})`);
  lines.push(location.description);

  if (currentNode) {
    lines.push("");
    lines.push(`## Current Room: ${currentNode.name}`);
    lines.push(currentNode.description);
    lines.push(`Feature: ${currentNode.feature}`);
    lines.push(`NPC: ${currentNode.npcSeed ?? "None"}`);

    if (adjacentNodes.length > 0) {
      lines.push("");
      lines.push("## Available Exits:");
      for (const { node, passageType } of adjacentNodes) {
        lines.push(`- ${node.name} — ${passageType}`);
      }
    } else {
      lines.push("");
      lines.push("## Available Exits:");
      lines.push("- (None — dead end)");
    }
  }

  if (visitedNodeIndices.length > 0) {
    const visitedNames = visitedNodeIndices
      .map((i) => exploration.allNodes.find((n) => n.index === i)?.name ?? `Node ${i}`)
      .join(", ");
    lines.push("");
    lines.push(`## Visited Rooms: ${visitedNames}`);
  }

  if (currentNode?.feature === "shop" && (currentNode as any).merchantPayload) {
    lines.push("");
    lines.push(formatShopNode((currentNode as any).merchantPayload, partyGold));
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Exploration Survival HUD
// ---------------------------------------------------------------------------

/**
 * Exploration time and resource snapshot injected into the system prompt.
 * Mirrors CampaignTime + PartyInventory DB fields — the caller fetches and passes these.
 */
export interface ExplorationHUDContext {
  totalTurns:                  number;
  totalHours:                  number;
  turnsSinceRest:              number;
  activeLightSource:           "torch" | "lantern" | "none";
  lightSourceTurnsRemaining:   number;
  torches:                     number;
  oilFlasks:                   number;
  rations:                     number;
  exhaustionLevel:             number;
}

const LIGHT_ICONS: Record<"torch" | "lantern" | "none", string> = {
  torch:   "🕯️",
  lantern: "🏮",
  none:    "⬛",
};

/**
 * Returns the "## ⏱️ Dungeon Clock & Survival" prompt section.
 * Gives the AI an accurate picture of time, light, and rations so it can
 * voice warnings and mandate `executeExplorationTurn` correctly.
 *
 * @pure — no I/O, deterministic output for the same input.
 */
export function formatSurvivalHUD(hud: ExplorationHUDContext): string {
  const lines: string[] = ["## ⏱️ Dungeon Clock & Survival"];

  // Time
  const minutesThisHour = (hud.totalTurns % TURNS_PER_HOUR) * 10;
  lines.push(`**Turn:** ${hud.totalTurns} — ${hud.totalHours}h ${minutesThisHour}min elapsed`);

  // Rest status
  const turnsUntilRest = REST_INTERVAL_TURNS - hud.turnsSinceRest;
  if (hud.turnsSinceRest >= REST_INTERVAL_TURNS) {
    lines.push("**Rest:** ⚠️ OVERDUE — mandatory rest not taken. Exhaustion applies on next non-rest action.");
  } else {
    lines.push(`**Rest:** ${turnsUntilRest} turn(s) until mandatory rest`);
  }

  // Exhaustion
  if (hud.exhaustionLevel > 0) {
    lines.push(`**Exhaustion:** Level ${hud.exhaustionLevel}/6 ⚠️`);
  }

  // Light source
  const lightIcon = LIGHT_ICONS[hud.activeLightSource];
  if (hud.activeLightSource === "none") {
    lines.push(`**Light:** ${lightIcon} Darkness — no active light source`);
  } else {
    const sourceName = hud.activeLightSource === "torch" ? "Torch" : "Lantern";
    lines.push(`**Light:** ${lightIcon} ${sourceName} — ${hud.lightSourceTurnsRemaining} turn(s) remaining`);
  }
  lines.push(`**Torches:** ${hud.torches} | **Oil Flasks:** ${hud.oilFlasks}`);

  // Rations
  lines.push(`**Rations:** ${hud.rations}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// NPC Social Context
// ---------------------------------------------------------------------------

/** Shape passed to formatNPCContext — mirrors the social fields on the NPC model. */
export interface ActiveNPC {
  name: string;
  disposition: number | null;
  personalityTags: NPCPersonality | null;
  hasMetPlayer: boolean;
}

const DISPOSITION_ICONS: Record<DispositionBand, string> = {
  Hostile:     "🔴",
  Unfriendly:  "🟠",
  Indifferent: "⚪",
  Friendly:    "🟢",
  Helpful:     "💛",
};

/**
 * Returns a "## 🎭 NPC" prompt section for the AI, grounding the narrator in
 * the NPC's persisted personality and current disposition.
 *
 * - Unmet NPC: instructs the AI to call `rollReaction` first.
 * - Met NPC: injects disposition band, icon, motivation, and distinctive trait.
 *   The secret is intentionally withheld from the narrator prompt to prevent
 *   premature disclosure — it is revealed only at Helpful disposition.
 *
 * @pure — no I/O, deterministic output for the same input.
 */
export function formatNPCContext(npc: ActiveNPC): string {
  if (!npc.hasMetPlayer) {
    return `## 🎭 NPC: ${npc.name}\n*(Not yet met — call rollReaction before first interaction.)*`;
  }

  const band = getDispositionBand(npc.disposition ?? 0);
  const icon = DISPOSITION_ICONS[band];
  const tags = npc.personalityTags;

  const lines: string[] = [
    `## 🎭 NPC: ${npc.name}`,
    `**Disposition:** ${icon} ${band} (${npc.disposition ?? 0})`,
  ];

  if (tags) {
    lines.push(`**Motivation:** ${tags.motivation}`);
    lines.push(`**Distinctive Trait:** ${tags.distinctiveTrait}`);
  }

  lines.push(
    "*(Note: The NPC's secret is known to them but concealed from the party. " +
    "Reveal it only if disposition reaches Helpful and the player asks the right question.)*"
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Wilderness HUD
// ---------------------------------------------------------------------------

export interface WildernessHUDContext {
  currentQ: number;
  currentR: number;
  terrain: string;
  biome: string;
  watchIndex: number;
  totalDays: number;
  weatherCondition: string;
  weatherIntensity: number;
  partyPace: string;
  rations: number;
  featureHere: boolean;
}

const WATCH_NAMES = ["Dawn", "Morning", "Midday", "Afternoon", "Evening", "Night"] as const;

function formatWildernessHUD(ctx: WildernessHUDContext): string {
  const watchName = WATCH_NAMES[ctx.watchIndex] ?? "Unknown";
  const lines: string[] = [
    "## Wilderness & Travel Status",
    `**Position:** Hex (${ctx.currentQ}, ${ctx.currentR}) — ${ctx.terrain} / ${ctx.biome}`,
    `**Watch:** ${watchName} (${ctx.watchIndex + 1}/6) — Day ${ctx.totalDays}`,
    `**Weather:** ${ctx.weatherCondition}${ctx.weatherIntensity > 0 ? ` (Intensity ${ctx.weatherIntensity})` : ""}`,
    `**Pace:** ${ctx.partyPace} | **Rations:** ${ctx.rations}`,
  ];
  if (ctx.featureHere) {
    lines.push("**Feature Present:** Yes — a notable location awaits investigation.");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Haven HUD
// ---------------------------------------------------------------------------

export interface HavenHUDContext {
  currentWealth: number;
  havenUpkeep: number;
  retainerMorale: string;
}

export function formatHavenHUD(ctx: HavenHUDContext): string {
  return [
    "## Haven & Downtime Status",
    `**Party Wealth:** ${ctx.currentWealth} GP`,
    `**Haven Upkeep:** ${ctx.havenUpkeep} GP/day`,
    `**Retainer Morale:** ${ctx.retainerMorale}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Returns a markdown-formatted system prompt section derived from the
 * current campaign context. Append this to the AI DM's system instructions
 * so the model always has accurate game state without hallucinating it.
 *
 * @pure — no side effects, deterministic output for the same input.
 */
export function formatSystemPrompt(
  context: CampaignContext & { gold?: number; activeNPC?: ActiveNPC; explorationHUD?: ExplorationHUDContext; wildernessHUD?: WildernessHUDContext; havenHUD?: HavenHUDContext },
): string {
  const locationType = context.currentExploration?.location?.type?.toLowerCase() ?? null;
  const hasLocation = Boolean(context.currentExploration?.location);
  const isOverworldScene = locationType === "wilderness" || (!hasLocation && Boolean(context.wildernessHUD));
  const isDungeonScene = hasLocation && locationType !== "wilderness";
  const isHavenScene = !hasLocation && !context.activeEncounter && Boolean(context.havenHUD);
  const shouldShowNPCContext = Boolean(context.activeNPC) && !context.activeEncounter;

  const memorySection = formatMemories(context.relevantMemories);
  const questSection = formatQuests(context.quests);
  const partyGold = context.gold ?? 0;
  const explorationSection = formatExploration(context.currentExploration, partyGold);

  const sections = [
    formatIronLaws(),
    // Long-Term Memory inserted here so the model reads historical context
    // before live game state. The empty-string guard means this slot is a
    // no-op (filtered out below) when no memories were retrieved.
    ...(memorySection ? [memorySection] : []),
    "# Current Game State",
    formatCharacter(context.character),
    // Exploration state injected between character and combat so the model
    // always knows the party's spatial context when resolving movement.
    ...(explorationSection ? [explorationSection] : []),
    // Survival HUD — dungeon clock, light, and rations. Injected when CampaignTime
    // and PartyInventory records exist and the party is in a dungeon scene.
    ...(context.explorationHUD && isDungeonScene ? [formatSurvivalHUD(context.explorationHUD)] : []),
    // Wilderness HUD — hex position, terrain, weather, pace, rations, watch clock.
    // Injected only in overworld scenes to avoid irrelevant context.
    ...(context.wildernessHUD && isOverworldScene ? [formatWildernessHUD(context.wildernessHUD)] : []),
    // Haven-only economics and morale context.
    ...(context.havenHUD && isHavenScene ? [formatHavenHUD(context.havenHUD)] : []),
    formatEncounter(context.activeEncounter),
    // Quest state injected after encounter so the model sees live combat first.
    // Empty-string guard: absent from prompt when no quests exist.
    ...(questSection ? [questSection] : []),
    // NPC social context — injected when the party is actively interacting
    // with a tracked NPC. Absent when no NPC is in scope.
    ...(shouldShowNPCContext && context.activeNPC ? [formatNPCContext(context.activeNPC)] : []),
    formatRecentLogs(context.recentLogs),
  ];

  return sections.join("\n\n");
}
