/**
 * lib/events/game-events.ts
 *
 * Deterministic game event types emitted by the action route before
 * the AI narration stream begins.  These are derived purely from
 * dice outcomes and state mutations — the AI never owns them.
 *
 * Transport: each event is sent as an SSE `data:` frame with a JSON
 * body of type ActionStreamFrame.  The client dispatches a
 * "dungeon-game-event" CustomEvent so GameEventHandler can react
 * (audio, visual) without being coupled to the fetch call.
 */

// ─── Event catalogue ────────────────────────────────────────────────────────
import type { MerchantPayload } from "@/lib/rules/trade";
import type { LevelUpAvailablePayload } from "@/lib/actions/backend-presentation-resolution";

export type GameEventType =
  | "CRITICAL_HIT"         // Natural 20 on an attack roll
  | "CRITICAL_MISS"        // Natural 1 on an attack roll
  | "DAMAGE_DEALT"         // Normal hit — target HP reduced
  | "ENEMY_DEFEATED"       // Target HP reaches 0
  | "SPELL_CAST"           // Spell slot successfully consumed
  | "HEALING_RECEIVED"     // Consumable heals the player
  | "PLAYER_DOWNED"        // Player HP reaches 0
  | "ENCOUNTER_START"      // Combat encounter begins; InitiativeTracker dispatches on mount
  | "TURN_ADVANCE"         // A combatant's turn begins (non-round-boundary)
  | "ROUND_ADVANCE"        // Turn index wrapped; a new combat round begins
  | "COMBAT_CONSEQUENCE"   // Full Consequences Engine payload from a resolved attack
  | "LOOT_GENERATED"       // generateLoot tool completed; LootPayload ready for display
  | "LEVEL_UP_RESOLVED"    // triggerLevelUp tool completed; LevelUpPayload ready for display
  | "CONCENTRATION_STARTED" // Combatant began concentrating on a spell
  | "CONCENTRATION_BROKEN"  // Combatant failed a concentration check or cast a new conc spell
  | "MOVE_COMBATANT"       // Combatant moved on the tactical grid
  | "EQUIP_ITEM"           // Item was equipped/unequipped
  | "REST_COMPLETED"       // Short or long rest completed
  | "EXPLORATION_WARNING"   // Resource depletion or other exploration danger
  | "PLAYER_MOVE"          // Player moved between dungeon nodes
  | "ABILITY_CHECK_RESOLVED"; // Improvised action settled by an ability check

/**
 * Payload emitted when the `generateLoot` AI tool completes.
 * Carries the full LootPayload so the VTT can show the Spoils of War overlay.
 * Shape mirrors LootPayload from lib/rules/loot.ts (duplicated to avoid
 * importing business-logic types into the event transport layer).
 */
export interface LootGeneratedPayload {
  gold: number;
  mundaneItems: Array<{
    name: string;
    type: string;
    rarity: string;
    description: string;
    properties: Record<string, unknown>;
    valueGP: number;
  }>;
  magicItems: Array<{
    name: string;
    type: string;
    rarity: string;
    description: string;
    properties: Record<string, unknown>;
    valueGP: number;
  }>;
  totalValue: number;
  rarityBracket: string;
  flavorText: string;
}

export interface SingleTargetConsequence {
  targetName: string;
  targetId: string;
  damage: number;
  naturalRoll: number;
  isCrit: boolean;
  isFumble: boolean;
  hitLocation: string;
  narrativeTags: string[];
  hpAfter: number;
  targetMaxHp: number;
  isKill: boolean;
  conditionsApplied: string[];
}

export interface CombatConsequencePayload {
  attackerName: string;
  targets: SingleTargetConsequence[];
}

export interface CombatConsequenceEvent {
  type: "COMBAT_CONSEQUENCE";
  payload: CombatConsequencePayload;
}

type StandardGameEventType = Exclude<GameEventType, "COMBAT_CONSEQUENCE">;

export type StandardGameEvent = {
  [Type in StandardGameEventType]: {
    type: Type;
    /** Contextual data for UI/audio — shape varies by event type. */
    payload: Record<string, unknown>;
  };
}[StandardGameEventType];

/**
 * Consequence events are structurally strict so producers and consumers cannot
 * bypass the canonical targets[] contract. Other event payloads remain open
 * while their individual contracts are migrated incrementally.
 */
export type GameEvent = CombatConsequenceEvent | StandardGameEvent;

// ─── SSE wire protocol ───────────────────────────────────────────────────────

/**
 * Payload emitted when the `triggerLevelUp` AI tool completes.
 * Shape mirrors LevelUpPayload from lib/rules/progression.ts.
 */
export interface LevelUpResolvedPayload {
  characterId:     string;
  previousLevel:   number;
  newLevel:        number;
  hitDie:          string;
  hpRoll:          number;
  conModifier:     number;
  hpGained:        number;
  previousMaxHp:   number;
  newMaxHp:        number;
  newHitDiceTotal: number;
  className:       string;
}

/**
 * Payload emitted when an NPC dialogue sequence is initiated.
 */
export interface DialogueOpenPayload {
  npcSeed: string;
  npcId:   string;
  name:    string;
  race:    string | null;
  profession: string | null;
  disposition:  number;
  personalityTags: {
    motivation:      string;
    secret:          string; // Received for future context; overlay must NOT render
    distinctiveTrait: string;
  } | null;
  hasMetPlayer: boolean;
}

/**
 * Discriminated union for frames sent over the action SSE stream.
 *
 *   t:"evt"      — a deterministic game event (fires before any LLM tokens)
 *   t:"level_up_available" — the backend detected a pending level-up but has
 *                  NOT applied it; the player must confirm via the level-up
 *                  route before any mechanical effect exists. Emitted after
 *                  the `evt` frames and before the first `txt` token, so the
 *                  UI learns this from backend state, never from prose.
 *   t:"txt"      — a text delta from the AI narrator
 *   t:"level_up" — reserved for a backend-authorised level-up resolution
 *   t:"merchant" — reserved for a backend-authorised merchant resolution
 *   t:"dialogue_open" — dialogue initiated; contains the full DialogueOpenPayload
 *   t:"dialogue_update" — social check resolved; contains the updated disposition
 *   t:"done"     — stream complete; client should call router.refresh()
 */
export type ActionStreamFrame =
  | { t: "evt"; e: GameEvent }
  | { t: "level_up_available"; payload: LevelUpAvailablePayload }
  | { t: "txt"; d: string }
  | { t: "level_up"; payload: LevelUpResolvedPayload }
  | { t: "merchant"; payload: MerchantPayload }
  | { t: "dialogue_open"; payload: DialogueOpenPayload }
  | { t: "dialogue_update"; disposition: number }
  | { t: "done" };
