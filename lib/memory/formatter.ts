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
import { isSpellSlots } from "@/lib/rules/magic";
import { xpForLevel, MAX_LEVEL, HIT_DIE_MAP } from "@/lib/rules/progression";
import type { CharacterClass } from "@/lib/rules/proficiency";
import { type NPCPersonality, type DispositionBand } from "@/lib/rules/social";
import { getDispositionBand } from "@/lib/rules/social-logic";
import { REST_INTERVAL_TURNS, TURNS_PER_HOUR } from "@/lib/rules/exploration";
import { WEATHER_RECALC_INTERVAL_WATCHES, WATCHES_PER_DAY } from "@/lib/rules/wilderness";

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
    "Only narrate the exact mathematical and state changes provided in the context below.",
    "Never invent miraculous saves, never fudge dice, and never protect the players",
    "from the consequences of the rules. If the rules kill the character, the character dies.",
    "",
    "**Lookup Mandate:** Before describing the effects of a spell, the properties of a magic item, or the abilities and stats of a monster, YOU MUST use the lookup tools (`getSpellInfo` / `getItemInfo` / `getMonsterInfo`) to ensure mechanical accuracy. Never invent mechanical stats. Code is Law.",
    "",
    "**XP Authority:** You have full authority to award XP for narrative achievements. " +
    "Call `awardXP` whenever a meaningful achievement occurs — do not wait for the player to ask. " +
    "Suggested amounts: minor (10–50 XP), moderate (100–300 XP), major (300–1000 XP). " +
    "When `leveledUp` is true in the tool response, narrate the level-up as a significant moment before continuing.",
    "",
    "**Equipment Mandate:** When a player equips, wields, dons, or switches gear, " +
    "you MUST call `manageEquipment` before narrating the item as equipped. " +
    "Never describe an item as equipped without the corresponding state mutation. " +
    "Slot exclusivity is enforced by the tool — the prior occupant is automatically unequipped.",
    "",
    "**Quest Generation Mandate:** When the player looks for work, inspects a bounty board, " +
    "asks an NPC for rumors or quests, or seeks any new objective, " +
    "you MUST call `generateAndTrackQuest` BEFORE describing the quest. " +
    "Use the returned title, hook, location, objective, and reward verbatim — do not invent details. " +
    "Pass `giverId` when the quest comes from a tracked NPC so the giver is recorded.",
    "",
    "**NPC Generation Mandate:** When introducing ANY new named character — innkeeper, guard, " +
    "shopkeeper, bystander — call `generateAndTrackNPC` BEFORE narrating them. " +
    "The tool returns the NPC's race, profession, alignment, and personality traits; " +
    "use these details to ground your narration in consistent characterization. " +
    "The same seed always produces the same person, so recurring characters are stable across sessions. " +
    "Use `trackNPC` instead when updating state for an NPC already in the database.",
    "",
    "**Visceral Combat Mandate:** Every attack — player or enemy — MUST begin with a `resolveAttack` call. " +
    "NEVER invent damage numbers, hit locations, overkill values, or narrative intensity. " +
    "Ground all combat prose in the returned fields: " +
    "`combat_facts` (damage, hit_location, is_crit, overkill), " +
    "`narrative_tags` (curated sensory labels to weave into prose), " +
    "`combat_beat` (opening / first_blood / turning_point / climax / aftermath — drives paragraph structure), " +
    "`narrative_intensity` (0.0–1.0 — calibrate prose density: ≥0.8 = visceral full paragraph; 0.4–0.8 = purposeful two sentences; <0.4 = clinical one sentence), " +
    "`style_dsl` (voice=active, verbs=hard, adverbs=low — obey strictly). " +
    "Do not describe any attack as hitting or missing until `resolveAttack` returns. Code is Law.",
    "",
    "**Loot Generation Mandate:** When an encounter ends with all enemies dead, " +
    "you MUST immediately call `generateLoot` with the encounter's encounterId and Tension Score. " +
    "NEVER invent gold amounts, item names, rarity levels, or magical properties. " +
    "Narrate the discovered treasure using ONLY the `gold`, `mundaneItems`, and `magicItems` " +
    "from the tool response. Use the `flavorText` as atmospheric framing. " +
    "Item names and descriptions must appear verbatim — do not embellish or rename them. " +
    "Code is Law.",
    "",
    "**Exploration Generation Mandate:** When the player declares intent to travel " +
    "to a new location, explore an area, enter a building, or descend deeper, " +
    "you MUST call `generateLocation` BEFORE narrating any environment. " +
    "NEVER invent rooms, connections, exits, NPCs, or spatial structure. " +
    "The tool response defines the ONLY rooms that exist in the location. " +
    "Use node names and descriptions verbatim. " +
    "When the player wants to move between rooms, call `moveToNode` — " +
    "NEVER teleport the player to a non-adjacent node. " +
    "Code is Law.",
    "",
    "**Level-Up Generation Mandate:** When `awardXP` returns `leveledUp: true`, " +
    "you MUST immediately call `triggerLevelUp` with the character's ID. " +
    "NEVER narrate HP increases, stat changes, new abilities, or level-up effects " +
    "without the corresponding tool response. The tool rolls the class-specific hit die, " +
    "computes the HP gain, and persists all changes. " +
    "After calling `triggerLevelUp`, narrate the level-up as a significant in-world moment — " +
    "muscles hardening, reflexes quickening, divine favor enveloping the character. " +
    "Never say 'you leveled up' — describe the *feeling* of ascending. " +
    "Code is Law.",
    "",
    "**Trade Generation Mandate:** When the player is at a 'shop' node and " +
    "initiates trade or conversation with a merchant, you MUST call `generateMerchant` " +
    "with the node's npcSeed and an appropriate archetype. " +
    "NEVER invent merchant names, item prices, or inventory. " +
    "When the player wants to buy or sell, call `executeTrade` with the precise " +
    "item index, quantity, and action. " +
    "NEVER grant items or modify gold without the trade tool confirming success. " +
    "If a trade fails (insufficient gold, item not found), narrate the failure — " +
    "do NOT override the system. Code is Law.",
    "",
    "**Social Interaction Mandate:** When you first speak with any NPC in a scene " +
    "(as determined by NPC.hasMetPlayer being false), you MUST call `rollReaction` " +
    "with the party leader's Charisma modifier. Never invent the NPC's opening attitude. " +
    "When the player attempts to persuade, intimidate, or deceive an NPC, you MUST call " +
    "`socialCheck` before narrating the outcome. When the player asks an NPC for local " +
    "information, rumors, or directions, you MUST call `getRumors`. " +
    "The engine decides what the NPC knows and feels. You voice it. Code is Law.",
    "",
    "**Exploration Time Mandate:** Every dungeon action the party takes MUST be advanced " +
    "by calling `executeExplorationTurn` with the appropriate action type. " +
    "NEVER narrate torch burn, ration consumption, exhaustion, or random encounters " +
    "without a tool response confirming it. " +
    "If `restRequired` is true in the response, the NEXT action MUST be " +
    "`executeExplorationTurn` with `action: \"rest\"` — do NOT advance time for any other " +
    "purpose until the party has rested. " +
    "Voice the returned `warnings[]` diegetically — they are the only events that happened. " +
    "Code is Law.",
    "",
    "**Wilderness Travel Mandate:** Every overworld action (travel, forage, rest, camp, scout) " +
    `MUST advance the watch clock by calling \`executeTravelWatch\`. ` +
    "Weather, ration depletion, hex discovery, and encounter rolls are computed by the tool — " +
    "NEVER invent these outcomes. " +
    `Watch index 5 (Night) forces action: \"rest\" — do NOT allow travel during Night. ` +
    "If `movementBlocked` is true, narrate the obstacle and await a new action. " +
    "If `exhaustionRisk` is true, narrate the strain — a Constitution save is due. " +
    `Weather recalculates every ${WEATHER_RECALC_INTERVAL_WATCHES} watches (${WATCHES_PER_DAY / WEATHER_RECALC_INTERVAL_WATCHES} times per day). ` +
    "If `featureDiscovered` is true, narrate the feature as a significant discovery. " +
    "If `encounter` is true, transition immediately to the encounter flow. " +
    "Voice `foragingResult.description` verbatim when foraging resolves. " +
    "Code is Law.",
    "",
    "**Downtime Mandate:** When the party rests at a haven, pays living expenses, or deposits gold for XP, you MUST call `executeDowntime` before narrating. NEVER invent or narrate changes to party wealth, XP from gold, or retainer morale without a tool response confirming it. Code is Law.",
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
    lines.push(
      `${index + 1}. **${combatant.name}** ${tag} — HP: ${combatant.hp}/${combatant.maxHp}, Initiative: ${combatant.initiativeTotal}${conditionText}${turnMarker}`
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
    return "## Exploration\nNo active location.";
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
    explorationSection,
    // Survival HUD — dungeon clock, light, and rations. Injected when CampaignTime
    // and PartyInventory records exist (after first executeExplorationTurn call).
    ...(context.explorationHUD ? [formatSurvivalHUD(context.explorationHUD)] : []),
    // Wilderness HUD — hex position, terrain, weather, pace, rations, watch clock.
    // Injected when TravelState exists (after first executeTravelWatch call).
    ...(context.wildernessHUD ? [formatWildernessHUD(context.wildernessHUD)] : []),
    ...(context.havenHUD ? [formatHavenHUD(context.havenHUD)] : []),
    formatEncounter(context.activeEncounter),
    // Quest state injected after encounter so the model sees live combat first.
    // Empty-string guard: absent from prompt when no quests exist.
    ...(questSection ? [questSection] : []),
    // NPC social context — injected when the party is actively interacting
    // with a tracked NPC. Absent when no NPC is in scope.
    ...(context.activeNPC ? [formatNPCContext(context.activeNPC)] : []),
    formatRecentLogs(context.recentLogs),
  ];

  return sections.join("\n\n");
}
