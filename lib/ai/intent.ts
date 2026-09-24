/**
 * lib/ai/intent.ts
 *
 * Structured intent parsing for "Code is Law" enforcement.
 *
 * Converts free-text player input into a typed, validated Intent object.
 * The rules engine uses the returned type to gate mechanics deterministically:
 *   - "cast_spell"  → validate spell slots via lib/rules/magic
 *   - "attack"      → resolve attack roll via lib/rules/combat
 *   - "use_item"    → validate inventory via lib/rules/inventory
 *   - "ability_check" → settle an improvised action via lib/rules/ability-check
 *   - "mechanical_ambiguous" → request clarification; never narrate as resolved
 *   - "general"     → no mechanical gate; pass straight to narration
 *
 * Every classification except "general" must have a gate. See the note on
 * IntentSchema.actionType.
 *
 * Architecture contract:
 *   - This module ONLY classifies intent. It never validates rules or mutates state.
 *   - The caller is responsible for acting on the returned type.
 */

import { z } from "zod";
import { getSpellInfo, type SpellEffect } from "@/lib/ai/tools/srd-lookup";
import { DIFFICULTY_BANDS, SKILLS, type Skill } from "@/lib/rules/ability-check";
import { matchImprovisedAction } from "@/lib/rules/improvised-actions";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Strict schema for a player's classified action intent.
 * Used both as the LLM output contract and as the TypeScript type source.
 */
export const IntentSchema = z.object({
  /**
   * Canonical action classification:
   * - "cast_spell" — player is attempting to cast a spell
   * - "attack"     — player is attempting a weapon/unarmed attack
   * - "use_item"   — player is attempting to use an inventory item
   * - "equip"      — player is attempting to equip an item
   * - "rest"       — player is attempting to take a short or long rest
   * - "mechanical_ambiguous" — potentially mechanical, but not safely classifiable
   * - "general"    — roleplay, dialogue, or anything non-mechanical
   *
   * Every value here except "general" MUST have a gate in
   * app/api/campaign/[id]/action/route.ts that resolves it or refuses it.
   * Adding one without a gate lets the narrator describe an outcome the rules
   * engine never determined — enforced by
   * tests/architecture/intent-gate-exhaustiveness.test.ts.
   */
  actionType: z.enum([
    "cast_spell",
    "attack",
    "use_item",
    "equip",
    "rest",
    "move",
    "travel",
    "ability_check",
    "mechanical_ambiguous",
    "general",
  ]),

  /**
   * SRD skill that adjudicates an improvised action.
   * Only present when actionType is "ability_check". Constrained to the SRD
   * skill list, so an intent can never name a skill the rules engine lacks.
   */
  skill: z.enum(SKILLS as [Skill, ...Skill[]]).optional(),

  /**
   * Difficulty band for an improvised action, from lib/rules/improvised-actions.
   * Only present when actionType is "ability_check".
   *
   * A band, never a raw DC: the enum makes an illegal difficulty
   * unrepresentable, and lib/rules/ability-check.ts is the only place that turns
   * a band into a number. Nothing outside the rules layer can widen the range of
   * possible DCs.
   */
  band: z
    .enum(DIFFICULTY_BANDS as [(typeof DIFFICULTY_BANDS)[number], ...typeof DIFFICULTY_BANDS])
    .optional(),

  /**
   * Explicit typed social interaction approach when an improvised action targets an NPC.
   * Only present for actual social vocabulary (persuade, deceive, intimidate).
   * Generic checks like disguise do NOT set this.
   */
  socialApproach: z.enum(["persuade", "deceive", "intimidate"]).optional(),

  /**
   * Name of the target (creature, NPC, object) if one is present in the input.
   * Omitted for untargeted or general actions.
   */
  targetName: z.string().optional(),

  /**
   * Canonical name of the spell being cast (e.g. "Fireball", "Cure Wounds").
   * Only present when actionType is "cast_spell". Used for SRD lookup.
   */
  spellName: z.string().optional(),

  /**
   * Spell slot level the player intends to use (0–9), where 0 is a cantrip.
   * Only relevant when actionType is "cast_spell".
   *
   * Omitted when the player did not name a level. That is the common case —
   * "I cast Fireball" — and it does NOT mean "no level": the gate resolves the
   * spell's own SRD level and charges that. The bound starts at 0 so a cantrip
   * is representable; a `min(1)` here previously made the slot-free case
   * impossible to express, leaving the gate's cantrip branch unreachable.
   */
  spellLevel: z.number().int().min(0).max(9).optional(),

  /**
   * Whether the player is taking a "short" or "long" rest.
   * Only relevant when actionType is "rest".
   */
  restType: z.enum(["short", "long"]).optional(),

  /**
   * The name or ID of the destination node the player wants to move to.
   * Only present when actionType is "move".
   */
  destination: z.string().optional(),

  /**
   * Whether the player chose to push through instead of camping.
   * Only meaningful when actionType is "travel". A forced march covers the
   * journey in one day and pays SRD Constitution saves for every hour past the
   * eighth; absent or false means the ordinary eight-hour days.
   */
  forceMarch: z.boolean().optional(),
});

export type BaseIntent = z.infer<typeof IntentSchema>;

export interface Intent extends BaseIntent {
  /** The strongly typed mechanical spell data resolved from the SRD, if applicable. */
  spellEffect?: SpellEffect | null;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Distinguishes ambient environmental observation ("What do I see?",
 * "I look around the room", "miro alrededor") from mechanical discovery
 * ("I search for traps", "I look for hidden doors", "busco trampas").
 *
 * Ambient observation requests narration of what is openly visible in the scene
 * and carries no mechanical uncertainty, so it resolves as "general" without
 * rolling dice or invoking rules. Any attempt to find hidden things, search,
 * or inspect specific mechanisms/clues must NOT match here and must proceed
 * to backend skill checks or fail closed.
 */
function isAmbientObservation(input: string): boolean {
  const clean = input
    .trim()
    .replace(/^[¿¡]/, "")
    .replace(/[.!?]+$/, "")
    .trim();

  // Search/discovery intent keywords never qualify as ambient observation.
  // "look for traps" or "mirar si hay" implies searching for hidden information.
  if (/\b(?:for|para\s+ver|buscando)\b/i.test(clean)) {
    return false;
  }

  // English ambient questions: "what do I see?", "what can I see?", "what do we see?", etc.
  if (
    /^what\s+(?:do|can)\s+(?:i|we)\s+see(?:\s+(?:around(?:\s+(?:me|us))?|here|in\s+the\s+(?:room|area|chamber|hall|cave|place)))?$/i.test(
      clean
    )
  ) {
    return true;
  }

  // Spanish ambient questions: "¿qué veo?", "¿qué puedo ver?", "¿qué se ve?", etc.
  if (
    /^qu[eé]\s+(?:veo|puedo\s+ver|podemos\s+ver|se\s+ve)(?:\s+(?:aqu[ií]|alrededor|en\s+la\s+(?:habitaci[oó]n|sala|estancia|cueva|zona)))?$/i.test(
      clean
    )
  ) {
    return true;
  }

  // English ambient observation phrasings:
  // "I look around", "take a look around", "I look around the room", "I look at the room",
  // "I look around carefully", etc.
  if (
    /^(?:i\s+)?(?:carefully\s+)?(?:look|take\s+a\s+look)\s+around(?:\s+(?:at|in)?\s*(?:the\s+)?(?:room|area|surroundings|chamber|hall|cave|place|scene))?(?:\s+carefully)?$/i.test(
      clean
    ) ||
    /^(?:i\s+)?(?:carefully\s+)?(?:look|take\s+a\s+look)\s+at\s+the\s+(?:room|area|surroundings|chamber|hall|cave|place|scene)(?:\s+carefully)?$/i.test(
      clean
    )
  ) {
    return true;
  }

  // Spanish ambient observation phrasings:
  // "miro alrededor", "echo un vistazo alrededor", "miro la habitación", "miro a mi alrededor"
  if (
    /^(?:(?:yo\s+)?(?:miro|mirar)|(?:echo|echar)\s+un\s+vistazo)\s+alrededor(?:\s+(?:de\s+la\s+(?:habitaci[oó]n|sala|estancia|cueva|zona)|con\s+cuidado))?$/i.test(
      clean
    ) ||
    /^(?:(?:yo\s+)?(?:miro|mirar)|(?:echo|echar)\s+un\s+vistazo)\s+(?:a\s+mi\s+alrededor|la\s+(?:habitaci[oó]n|sala|estancia|zona|cueva|escena)|el\s+(?:lugar|cuarto|entorno)|a\s+la\s+(?:habitaci[oó]n|sala|estancia|zona|cueva))(?:\s+con\s+cuidado)?$/i.test(
      clean
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Parses a player's free-text action into a structured Intent.
 *
 * @param playerInput - Raw text the player typed (e.g. "I cast Fireball at level 3 on the orc").
 * @returns           A validated Intent object ready for rules-engine gating.
 */
export async function parseIntent(playerInput: string): Promise<Intent> {
  const input = playerInput.trim().replace(/\s+/g, " ");
  const lower = input.toLocaleLowerCase("en");

  // Fail closed: anything this parser cannot positively classify is treated as
  // a possible mechanical action and sent back for clarification, never handed
  // to the narrator as if it had already resolved.
  let intent: Intent = { actionType: "mechanical_ambiguous" };

  // Callers match target names against combatant and item names by substring, so
  // a leading article makes the lookup fail: "the goblin" is not contained in
  // "Goblin". Every extracted name goes through here.
  const cleanName = (raw: string | undefined): string | undefined => {
    const value = raw?.trim().replace(/^(?:the|el|la|los|las|al)\s+/i, "");
    return value || undefined;
  };

  // "lie to the guard" and "robo al mercader" name the creature after a
  // preposition. cleanName strips the article that follows; this strips the
  // preposition first so the two compose into a bare name.
  const stripLeadingPreposition = (raw: string | undefined): string | undefined =>
    raw?.replace(
      /^(?:to|at|on|from|off|against|behind|past|with|a|al|a\s+la|de|del|contra|hacia|tras|detrás\s+de|con)\s+/i,
      ""
    );

  // Social actions frequently attach infinitive or content clauses to the target
  // ("I persuade the innkeeper to open the gate", "I deceive the guard that we are merchants",
  // "persuado al posadero para que abra la puerta"). Stripping the clause isolates
  // the target creature deterministically without invoking an NLP parser.
  // If the action begins directly with or consists of a purpose/content clause with
  // no preceding target noun ("I negotiate to lower the price", "I bluff that we are merchants",
  // "negocio para bajar el precio", "engaño diciendo que somos mercaderes"), it resolves to undefined.
  const cleanSocialTarget = (raw: string | undefined): string | undefined => {
    if (!raw) return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;

    // Check if the input begins directly with or consists of a purpose/content clause
    // (with no preceding target noun).
    // In English, "to" can also precede a target NPC ("to the guard", "to a merchant").
    // If "to" is followed by an article ("the", "a", "an"), it introduces a target noun.
    const isTargetlessClause =
      /^(?:that|into|about|para\s+que|para|de\s+que|diciendo\s+que|que|sobre)\b/i.test(trimmed) ||
      /^to\s+(?!(?:the|a|an)\s+)/i.test(trimmed);

    if (isTargetlessClause) {
      return undefined;
    }

    // If an explicit target noun precedes a purpose/content clause:
    // "the guard to open the gate" -> "the guard"
    // "the merchant that we are nobles" -> "the merchant"
    // "con el mercader para bajar el precio" -> "con el mercader"
    // "al guardia diciendo que somos nobles" -> "al guardia"
    const match = trimmed.match(
      /^(.*?)(?:\s+(?:to|that|into|about|para\s+que|para|de\s+que|diciendo\s+que|que|sobre)\s+.+)$/i
    );
    const candidate = match ? match[1] : trimmed;

    const withoutPrep = stripLeadingPreposition(candidate)?.trim();
    if (!withoutPrep) return undefined;

    const candidateTarget = withoutPrep
      .replace(/^[¿¡\s]+/, "")
      .replace(/[.!?\s]+$/, "")
      .trim();

    return cleanName(candidateTarget);
  };

  const prefixedValue = (pattern: RegExp): string | undefined => {
    const match = input.match(pattern);
    return cleanName(match?.[1] ?? match?.[2]);
  };

  const castMatch = input.match(
    /^(?:i\s+)?(?:cast|conjure|lanzo|lanzar|conjuro|conjurar)\s+(.+)$/i
  );
  if (castMatch) {
    let remainder = castMatch[1].trim();
    const levelMatch = remainder.match(
      /\s+(?:at|using|a|al|usando)\s+(?:slot\s+)?(?:level|nivel)\s*(\d)\b/i
    );
    const spellLevel = levelMatch ? Number(levelMatch[1]) : undefined;
    if (levelMatch?.index !== undefined) {
      remainder =
        remainder.slice(0, levelMatch.index) +
        remainder.slice(levelMatch.index + levelMatch[0].length);
    }

    const targetMatch = remainder.match(
      /\s+(?:on|against|at|sobre|contra|hacia)\s+(.+)$/i
    );
    const targetName = cleanName(targetMatch?.[1]);
    const spellName = (
      targetMatch?.index === undefined
        ? remainder
        : remainder.slice(0, targetMatch.index)
    )
      .replace(/^(?:the\s+spell|el\s+conjuro|el\s+hechizo)\s+/i, "")
      .trim();

    intent = {
      actionType: "cast_spell",
      ...(spellName ? { spellName } : {}),
      ...(spellLevel !== undefined ? { spellLevel } : {}),
      ...(targetName ? { targetName } : {}),
    };
  } else if (
    /^(?:i\s+)?(?:attack|strike|hit|shoot|fire|stab|slash|punch|kick|ataco|atacar|golpeo|golpear|disparo|disparar|apuñalo|apuñalar)\b/i.test(
      input
    )
  ) {
    intent = {
      actionType: "attack",
      targetName: prefixedValue(
        /^(?:i\s+)?(?:attack|strike|hit|shoot|fire|stab|slash|punch|kick|ataco|atacar|golpeo|golpear|disparo|disparar|apuñalo|apuñalar)(?:\s+(?:at|al|a|contra))?\s*(.*)$/i
      ),
    };
  } else if (/^(?:i\s+)?(?:use|drink|usar|uso|beber|bebo)\b/i.test(input)) {
    intent = {
      actionType: "use_item",
      targetName: prefixedValue(
        /^(?:i\s+)?(?:use|drink|usar|uso|beber|bebo)\s+(.+?)(?:\s+(?:on|sobre)\s+.+)?$/i
      ),
    };
  } else if (/^(?:i\s+)?(?:equip|wield|don|equipar|equipo|empuñar|empuño)\b/i.test(input)) {
    intent = {
      actionType: "equip",
      targetName: prefixedValue(
        /^(?:i\s+)?(?:equip|wield|don|equipar|equipo|empuñar|empuño)\s+(.+)$/i
      ),
    };
  } else if (
    /\b(?:short|long)\s+rest\b/i.test(input) ||
    /\bdescanso\s+(?:corto|largo)\b/i.test(input)
  ) {
    // Which rest, decided from the phrases actually present rather than from
    // a single "does 'long rest' appear anywhere" test.
    //
    // That older test could not tell an intention from its negation: "not a
    // long rest, just a short rest" contains the words and classified as LONG,
    // and the rest gate takes `restType` as authority — so the player was
    // handed full hit points, every spell slot and a step off exhaustion for
    // saying the opposite. The error was one-directional, and its direction
    // was the one that grants resources.
    //
    // Naming both rests is genuinely ambiguous, so it fails closed rather than
    // being guessed. Detecting negation instead — "not", "instead of",
    // "rather than", "no es un" — is a guessing game this parser has no
    // business playing, and getting it wrong reintroduces the same defect
    // through a longer regex.
    const namesLongRest = /\b(?:long\s+rest|descanso\s+largo)\b/i.test(input);
    const namesShortRest = /\b(?:short\s+rest|descanso\s+corto)\b/i.test(input);

    intent = namesLongRest && namesShortRest
      ? { actionType: "mechanical_ambiguous" }
      : { actionType: "rest", restType: namesLongRest ? "long" : "short" };
  } else if (
    /^(?:i\s+)?(?:travel|journey)\s+to\b/i.test(input) ||
    /^(?:viajar|viajo)\s+(?:a|hacia)\b/i.test(input)
  ) {
    // Its own verbs, deliberately not sharing "go to" with the move branch:
    // movement inside a location and a journey between them are different
    // gates, and one wrong guess sends the party days away.
    intent = {
      actionType: "travel",
      destination: prefixedValue(
        /^(?:i\s+)?(?:travel|journey)\s+to\s+(.+?)(?:\s*,\s*(?:forced\s+march|pushing\s+on|without\s+rest))?$|^(?:viajar|viajo)\s+(?:a|hacia)\s+(.+?)(?:\s*,\s*(?:marcha\s+forzada|sin\s+descanso))?$/i
      ),
      forceMarch:
        /\b(?:forced\s+march|pushing\s+on|without\s+rest|marcha\s+forzada|sin\s+descanso)\b/i.test(
          input
        ),
    };
  } else if (
    /^(?:i\s+)?(?:move|go|walk)\s+to\b/i.test(input) ||
    /^(?:moverme|mover|ir|caminar)\s+(?:a|hacia)\b/i.test(input)
  ) {
    intent = {
      actionType: "move",
      destination: prefixedValue(
        /^(?:i\s+)?(?:move|go|walk)\s+to\s+(.+)$|^(?:moverme|mover|ir|caminar)\s+(?:a|hacia)\s+(.+)$/i
      ),
    };
  } else if (lower === "rest" || lower === "descansar" || lower === "descanso") {
    intent = { actionType: "rest", restType: "short" };
  } else if (isAmbientObservation(input)) {
    intent = { actionType: "general" };
  } else if (
    /^(?:(?:i\s+)?(?:say|ask|tell|greet|speak|talk|reply|answer|smile|laugh|cry|nod|bow|wave|sing|whisper|shout)|(?:digo|pregunto|saludo|hablo|respondo|sonrío|rio|río|lloro|asiento|me\s+inclino|canto|susurro|grito))\b|^(?:hello|hi|greetings|hola|buenas)\b/i.test(
      input
    )
  ) {
    intent = { actionType: "general" };
  } else {
    // No dedicated mechanic matched. Before giving up, try to adjudicate the
    // action as an improvised skill check — the SRD's own answer to "the player
    // tried something the rules do not name".
    //
    // This tier is also where "search", "investigate" and "hide" now land.
    // They used to be caught earlier by an "explore" branch that no gate
    // consumed, so searching a room reached the narrator with nothing rolled.
    // Here they get the skill the SRD actually assigns them. The verbs too
    // vague to adjudicate ("I explore", "I travel north") deliberately match
    // nothing and fall through to clarification: the SRD has no roll for them
    // either, and asking beats inventing an outcome.
    //
    // The vocabulary and its difficulties live in lib/rules, not here: how hard
    // an action is, is a rules question. This layer only reports which entry the
    // player's wording matched.
    const improvised = matchImprovisedAction(input);
    if (improvised) {
      // The creature the action names, when it names one. Contests that resist
      // with a single creature — pickpocketing a mark, lying to a listener,
      // shoving an opponent — need to know which one; without it the backend
      // would have to contest against whoever else happened to be standing
      // there. Absent or unrecognisable, the gate falls back to a band.
      const targetName = improvised.action.socialApproach
        ? cleanSocialTarget(improvised.rest)
        : cleanName(stripLeadingPreposition(improvised.rest));

      intent = {
        actionType: "ability_check",
        skill: improvised.action.skill,
        band: improvised.action.band,
        ...(improvised.action.socialApproach
          ? { socialApproach: improvised.action.socialApproach }
          : {}),
        ...(targetName ? { targetName } : {}),
      };
    }
  }

  intent = IntentSchema.parse(intent);

  // Consume strongly typed SpellEffect immediately if spell was identified.
  // The caller acts on this without hallucinating raw JSON stats.
  if (intent.actionType === "cast_spell" && intent.spellName) {
    intent.spellEffect = await getSpellInfo(intent.spellName);
  }

  return intent;
}
