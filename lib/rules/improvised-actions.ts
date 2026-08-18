/**
 * lib/rules/improvised-actions.ts
 *
 * The vocabulary of improvised actions, and how hard each one is.
 *
 * SRD 5e settles any action without a dedicated rule as an ability check. That
 * leaves two questions the rules engine must answer before the dice are rolled:
 * which skill adjudicates the attempt, and against what Difficulty Class. This
 * module answers both, deterministically, from the player's own wording.
 *
 * ─── Why the verb and not the skill ──────────────────────────────────────────
 * Difficulty used to be a single constant: every improvised action resolved
 * against DC 15, so forcing a jammed portcullis and listening at a door were
 * equally hard. Keying difficulty to the skill alone would barely improve that,
 * because one skill spans very different tasks — Athletics covers climbing a
 * knotted rope and dead-lifting a gate. The verb is the finest contextual signal
 * available without a model call, so the table keys on it.
 *
 * ─── Status of these numbers ─────────────────────────────────────────────────
 * The SRD supplies the *scale* — the six difficulty bands in
 * lib/rules/ability-check.ts are the DMG's "Typical Difficulty Classes". It does
 * not supply a verb-to-DC map; there is no canonical table saying that prying a
 * door is Hard.
 *
 * So the bands below are a HOUSE TABLE built on the DMG's scale, not SRD canon
 * transcribed. It is stated here rather than left implicit because the backend
 * owns mechanical truth: a house ruling belongs in the rules layer, declared,
 * versioned and testable — not smuggled in as if it were canon, and never left
 * to the narrator to improvise per turn.
 *
 * Where the SRD does give a number, it anchors the scale:
 *   - Stabilising a dying creature is explicitly DC 10 → "easy".
 *
 * ─── When a creature resists ─────────────────────────────────────────────────
 * A band is only the right answer when nothing is pushing back. Some of these
 * actions are contests in the SRD — hiding, pickpocketing, lying, shoving — and
 * for those the entry names who resists and with what. The DC then comes from
 * that creature's own ability scores, so hiding from an alert sentry is harder
 * than hiding from a dull one for a reason the rules can point at, rather than
 * because someone picked a label.
 *
 * ─── Architecture ────────────────────────────────────────────────────────────
 * This module is pure: it matches text and reports. It never rolls and never
 * mutates state, and it never picks a raw DC — it names a band or an
 * opposition, and lib/rules/ability-check.ts turns either into a number.
 * lib/ai/intent.ts consumes it; the dependency runs ai → rules, never the
 * other way.
 */

import type { DifficultyBand } from "./ability-check";
import type { Skill } from "./ability-check";

export interface ImprovisedAction {
  /** Matches the player's phrasing. Anchored: the verb must open the action. */
  readonly pattern: RegExp;
  /** SRD skill that adjudicates the attempt. */
  readonly skill: Skill;
  /**
   * Difficulty band, used when nothing is actively resisting. Mapped to a DC by
   * computeAbilityCheckDC.
   */
  readonly band: DifficultyBand;
  /**
   * Present when creatures resist the attempt, in which case their own ability
   * scores set the DC and the band is not used.
   */
  readonly opposedBy?: ImprovisedOpposition;
}

export interface ImprovisedOpposition {
  /**
   * Skills the resisting creature may use. The best passive score among them
   * wins — the SRD lets a creature resist a shove with Athletics or Acrobatics,
   * whichever serves it better.
   */
  readonly skills: readonly Skill[];
  /**
   * Who resists.
   *
   * - "observers": everyone present could notice, so the most alert of them
   *   sets the difficulty. Sneaking past a patrol is as hard as its sharpest
   *   sentry.
   * - "single": the attempt is directed at one creature. Applied only when
   *   exactly one candidate is present; with several the caller cannot know
   *   which one is meant, so it falls back to the band rather than guessing.
   */
  readonly scope: "observers" | "single";
}

/**
 * Improvised actions, in match order.
 *
 * Checked only after every dedicated mechanic has been ruled out, so nothing
 * here shadows a real gate. Within the table the first match wins, so no verb
 * may appear in two entries.
 *
 * Each entry carries both English and Spanish phrasings of the same action, so
 * a bilingual player reaches the same rule and the same difficulty.
 */
export const IMPROVISED_ACTIONS: readonly ImprovisedAction[] = [
  // ── Athletics, split by how much the task actually asks of the body ────────
  {
    // Routine athletic movement: a climbable wall, a gap you can clear.
    pattern:
      /^(?:i\s+)?(?:climb|jump|leap|swim)\b|^(?:trepo|trepar|escalo|escalar|salto|saltar|nado|nadar)\b/i,
    skill: "Athletics",
    band: "easy",
  },
  {
    // Moving a creature or a heavy object that resists you.
    pattern:
      /^(?:i\s+)?(?:push|shove|drag|grapple|wrestle)\b|^(?:empujo|empujar|arrastro|arrastrar|agarro|agarrar|derribo|derribar)\b/i,
    skill: "Athletics",
    band: "medium",
    // SRD resolves shoving and grappling as a contest against the target's
    // Athletics, or its Acrobatics if that serves it better.
    opposedBy: { skills: ["Athletics", "Acrobatics"], scope: "single" },
  },
  {
    // Overcoming something built or weighted to resist: a barred door, a
    // portcullis, an opponent's grip on their weapon.
    pattern:
      /^(?:i\s+)?(?:force|pry|break|smash|lift|disarm)\b|^(?:fuerzo|forzar|rompo|romper|levanto|levantar|desarmo|desarmar)\b/i,
    skill: "Athletics",
    band: "hard",
  },

  {
    pattern:
      /^(?:i\s+)?(?:tumble|balance|vault|somersault|dodge)\b|^(?:hago\s+una\s+voltereta|me\s+equilibro|equilibrarme|esquivo|esquivar)\b/i,
    skill: "Acrobatics",
    band: "medium",
  },
  {
    // Taking something off a person without them noticing is one of the DMG's
    // own examples of a genuinely demanding task.
    pattern:
      /^(?:i\s+)?(?:pickpocket|steal|palm|swipe)\b|^(?:robo|robar|hurto|hurtar|birlo|birlar)\b/i,
    skill: "Sleight of Hand",
    band: "hard",
    // SRD: contested by the target's passive Perception.
    opposedBy: { skills: ["Perception"], scope: "observers" },
  },
  {
    pattern:
      /^(?:i\s+)?(?:sneak|creep|skulk|hide|slip\s+past)\b|^(?:me\s+escabullo|escabullirme|me\s+cuelo|colarme|me\s+oculto|ocultarme|me\s+escondo|esconderme)\b/i,
    skill: "Stealth",
    band: "medium",
    // SRD: a Stealth check is contested by the passive Perception of every
    // creature that might notice, so the most alert one sets the difficulty.
    opposedBy: { skills: ["Perception"], scope: "observers" },
  },
  {
    // Noticing what is there to be noticed, rather than deducing what is hidden.
    pattern:
      /^(?:i\s+)?(?:listen|spot|notice|watch|peek)\b|^(?:escucho|escuchar|observo|observar|vigilo|vigilar|atisbo|atisbar)\b/i,
    skill: "Perception",
    band: "easy",
  },
  {
    pattern:
      /^(?:i\s+)?(?:examine|inspect|study|search|investigate|analyse|analyze)\b|^(?:examino|examinar|inspecciono|inspeccionar|estudio|estudiar|busco|buscar|investigo|investigar|registro|registrar|analizo|analizar)\b/i,
    skill: "Investigation",
    band: "medium",
  },
  {
    pattern:
      /^(?:i\s+)?(?:track|forage|navigate|forrage)\b|^(?:rastreo|rastrear|forrajeo|forrajear|oriento|orientarme)\b/i,
    skill: "Survival",
    band: "medium",
  },
  {
    // The SRD's own anchor: stabilising a dying creature is DC 10.
    pattern:
      /^(?:i\s+)?(?:heal|treat|bandage|stabilise|stabilize)\b|^(?:curo|curar|sano|sanar|vendo|vendar|estabilizo|estabilizar)\b/i,
    skill: "Medicine",
    band: "easy",
  },
  {
    pattern:
      /^(?:i\s+)?(?:calm|tame|soothe|ride)\b|^(?:calmo|calmar|domo|domar|monto|montar)\b/i,
    skill: "Animal Handling",
    band: "medium",
  },
  {
    pattern:
      /^(?:i\s+)?(?:persuade|convince|plead|negotiate)\b|^(?:persuado|persuadir|convenzo|convencer|negocio|negociar|suplico|suplicar)\b/i,
    skill: "Persuasion",
    band: "medium",
  },
  {
    // Selling a lie to someone with reason to doubt you.
    pattern:
      /^(?:i\s+)?(?:lie|deceive|bluff|trick|disguise)\b|^(?:miento|mentir|engaño|engañar|finjo|fingir|disfrazo|disfrazarme)\b/i,
    skill: "Deception",
    band: "hard",
    // SRD: contested by the listener's Insight.
    opposedBy: { skills: ["Insight"], scope: "observers" },
  },
  {
    pattern:
      /^(?:i\s+)?(?:intimidate|threaten|menace|scare)\b|^(?:intimido|intimidar|amenazo|amenazar|asusto|asustar)\b/i,
    skill: "Intimidation",
    band: "medium",
  },
];

/**
 * Strips "I try to" / "intento" framing so the verb is reachable.
 *
 * Players routinely phrase an improvised action as an attempt. Only this tier
 * sees the stripped form; the dedicated gates keep matching the input exactly as
 * typed, so stripping can never divert an action away from its real mechanic.
 */
const ATTEMPT_PREFIX =
  /^(?:i\s+(?:try|attempt)\s+to\s+|intento\s+|trato\s+de\s+|pruebo\s+a\s+)/i;

/**
 * Finds the improvised action a phrase describes, or null when the SRD has no
 * roll for it.
 *
 * Returning null is a meaningful answer, not a failure: "I explore" names no
 * task a check can settle, and the caller is expected to ask the player what
 * they are actually doing rather than invent an outcome.
 */
export function matchImprovisedAction(input: string): ImprovisedAction | null {
  // Normalised here rather than by the caller so that every caller matches the
  // same way. The action route looks the entry up a second time to read its
  // opposition, and the two lookups must not disagree because one of them
  // collapsed runs of whitespace and the other did not.
  const normalised = input.trim().replace(/\s+/g, " ");
  const attempted = normalised.replace(ATTEMPT_PREFIX, "");
  return (
    IMPROVISED_ACTIONS.find(
      (action) => action.pattern.test(normalised) || action.pattern.test(attempted)
    ) ?? null
  );
}
