import { beforeEach, describe, expect, it, vi } from "vitest";

const getSpellInfo = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/tools/srd-lookup", () => ({ getSpellInfo }));

import { IntentSchema, parseIntent } from "@/lib/ai/intent";

describe("deterministic intent parser", () => {
  beforeEach(() => {
    getSpellInfo.mockReset();
    getSpellInfo.mockResolvedValue(null);
  });

  it.each([
    ["attack the goblin", "attack", "goblin"],
    ["I shoot the goblin", "attack", "goblin"],
    ["atacar al goblin", "attack", "goblin"],
    ["use the Potion of Healing", "use_item", "Potion of Healing"],
    ["equip the longsword", "equip", "longsword"],
  ])("classifies %s without model output", async (input, actionType, targetName) => {
    await expect(parseIntent(input)).resolves.toMatchObject({
      actionType,
      targetName,
    });
  });

  it.each([
    ["cast Fireball on the goblin", "goblin"],
    ["cast Fireball on goblin", "goblin"],
    ["lanzo Bola de Fuego contra el goblin", "goblin"],
  ])("strips the article from a spell target in %s", async (input, targetName) => {
    // Callers match by substring against combatant names, so "the goblin" would
    // never be found inside "Goblin".
    await expect(parseIntent(input)).resolves.toMatchObject({
      actionType: "cast_spell",
      targetName,
    });
  });

  it("extracts an SRD spell, slot level, and target", async () => {
    getSpellInfo.mockResolvedValue({ name: "Fireball", level: 3 });
    await expect(
      parseIntent("cast Fireball at level 3 on goblin")
    ).resolves.toMatchObject({
      actionType: "cast_spell",
      spellName: "Fireball",
      spellLevel: 3,
      targetName: "goblin",
      spellEffect: { level: 3 },
    });
  });

  it("keeps non-mechanical roleplay as general narration", async () => {
    await expect(parseIntent("I greet the innkeeper")).resolves.toEqual({
      actionType: "general",
    });
    await expect(
      parseIntent("I tell the innkeeper I am ready")
    ).resolves.toEqual({
      actionType: "general",
    });
  });

  it.each([
    ["I push the boulder", "Athletics", "medium"],
    ["empujo la roca", "Athletics", "medium"],
    ["I try to disarm the goblin", "Athletics", "hard"],
    ["intento desarmar al goblin", "Athletics", "hard"],
    ["I attempt to climb the wall", "Athletics", "easy"],
    ["I sneak past the guard", "Stealth", "medium"],
    ["I lie to the guard", "Deception", "hard"],
    ["miento al guardia", "Deception", "hard"],
    ["I intimidate the merchant", "Intimidation", "medium"],
    ["I persuade the innkeeper", "Persuasion", "medium"],
    ["I examine the runes", "Investigation", "medium"],
    ["I listen at the door", "Perception", "easy"],
    // The SRD's own anchor for the scale.
    ["I stabilize the dying scout", "Medicine", "easy"],
  ])(
    "adjudicates %s as an improvised skill check with its own difficulty",
    async (input, skill, band) => {
      // toMatchObject, not toEqual: these phrasings also name a creature, and
      // the extracted targetName varies per case. It is pinned separately below.
      await expect(parseIntent(input)).resolves.toMatchObject({
        actionType: "ability_check",
        skill,
        band,
      });
    }
  );

  it("keeps a bare verb free of an invented target", async () => {
    // Strict: nothing beyond the three fields may appear when the player named
    // no creature. A stray targetName here would send the gate contesting
    // against something nobody mentioned.
    await expect(parseIntent("I hide")).resolves.toEqual({
      actionType: "ability_check",
      skill: "Stealth",
      band: "medium",
    });
  });

  it.each([
    ["I pickpocket the merchant", "merchant"],
    ["I lie to the guard", "guard"],
    ["I shove the goblin", "goblin"],
    ["I try to shove the goblin", "goblin"],
    ["I hide from the sentry", "sentry"],
    ["robo al mercader", "mercader"],
    ["miento al guardia", "guardia"],
    ["empujo al goblin", "goblin"],
  ])("names the creature in %s as %s", async (input, targetName) => {
    // Contests that resist with one creature need to know which. Without this
    // the backend contested against whoever else was standing there.
    await expect(parseIntent(input)).resolves.toMatchObject({
      actionType: "ability_check",
      targetName,
    });
  });

  it("gives one skill different difficulties depending on the task", async () => {
    // The point of keying difficulty to the verb: Athletics used to be a single
    // value, so hauling a portcullis and hopping a fence were equally hard.
    const bandFor = async (input: string) =>
      (await parseIntent(input)).band;

    expect(await bandFor("I climb the wall")).toBe("easy");
    expect(await bandFor("I push the cart")).toBe("medium");
    expect(await bandFor("I force the door")).toBe("hard");
  });

  it("never lets an improvised check shadow a dedicated mechanic", async () => {
    // "attack" has its own gate and must keep it.
    await expect(parseIntent("attack the goblin")).resolves.toMatchObject({
      actionType: "attack",
    });
  });

  it.each([
    // Searching a room is the SRD's Investigation, not a free narration. These
    // used to classify as "explore", which no gate consumed: the narrator
    // described the outcome of a search nobody had rolled.
    ["I search the room", "Investigation", "medium"],
    ["search for traps", "Investigation", "medium"],
    ["busco trampas", "Investigation", "medium"],
    ["registro la habitación", "Investigation", "medium"],
    ["I investigate the area", "Investigation", "medium"],
    ["investigar la zona", "Investigation", "medium"],
    // Hiding is Stealth, and used to be swallowed by the same dead branch.
    ["I hide behind the crates", "Stealth", "medium"],
    ["me escondo tras las cajas", "Stealth", "medium"],
    ["ocultarme en la sombra", "Stealth", "medium"],
  ])(
    "adjudicates %s with a real skill check instead of narrating it",
    async (input, skill, band) => {
      await expect(parseIntent(input)).resolves.toMatchObject({
        actionType: "ability_check",
        skill,
        band,
      });
    }
  );

  it.each([
    // Too vague for the SRD to adjudicate: there is no roll for "I explore".
    // Failing closed asks the player what they are actually doing, which is
    // strictly better than letting the narrator invent the outcome.
    "I explore",
    "explorar",
    "I scout ahead",
    // "viajo al norte" stays here deliberately: the travel branch below only
    // recognizes "viajar/viajo a|hacia", not "al" (a+el), so this input still
    // has no dedicated mechanic and must still fail closed.
    "viajo al norte",
  ])("refuses %s rather than narrating an unresolved action", async (input) => {
    await expect(parseIntent(input)).resolves.toEqual({
      actionType: "mechanical_ambiguous",
    });
  });

  it("no longer emits a classification that no gate consumes", async () => {
    // Guarded structurally in tests/architecture/intent-gate-exhaustiveness.test.ts;
    // asserted here too so the schema change itself is deliberate.
    //
    // "travel" is no longer in that category: Task 2 gave it its own gate in
    // app/api/campaign/[id]/action/route.ts, and IntentSchema is expected to
    // emit it now — see the "parseIntent — travel" suite below.
    const options = IntentSchema.shape.actionType.options as readonly string[];
    expect(options).not.toContain("explore");
  });

  it("reaches cantrips, which the slot-level bound used to make unrepresentable", async () => {
    getSpellInfo.mockResolvedValue({ name: "Fire Bolt", level: 0 });
    await expect(
      parseIntent("cast Fire Bolt at level 0 on goblin")
    ).resolves.toMatchObject({
      actionType: "cast_spell",
      spellName: "Fire Bolt",
      spellLevel: 0,
    });
  });

  it("still flags a genuinely unmappable mechanical action for clarification", async () => {
    // Clarification is now the last resort, not the default: it applies only to
    // input that matches no dedicated mechanic and no improvised skill either.
    await expect(
      parseIntent("I poison the goblin")
    ).resolves.toEqual({
      actionType: "mechanical_ambiguous",
    });
    await expect(
      parseIntent("I sabotage the mechanism somehow")
    ).resolves.toEqual({
      actionType: "mechanical_ambiguous",
    });
  });
});

describe("parseIntent — travel", () => {
  it("classifies an English journey and extracts the destination", async () => {
    const intent = await parseIntent("travel to the Gilded Boar");
    expect(intent.actionType).toBe("travel");
    expect(intent.destination).toBe("Gilded Boar");
    expect(intent.forceMarch).toBe(false);
  });

  it("classifies a Spanish journey", async () => {
    const intent = await parseIntent("viajar a la Cripta Sable");
    expect(intent.actionType).toBe("travel");
    expect(intent.destination).toBe("Cripta Sable");
  });

  it("reads a forced march as a choice, not a destination", async () => {
    const intent = await parseIntent("travel to the Gilded Boar, forced march");
    expect(intent.actionType).toBe("travel");
    expect(intent.destination).toBe("Gilded Boar");
    expect(intent.forceMarch).toBe(true);
  });

  /**
   * "go to" is movement inside a location and must keep reaching the `move`
   * gate. Travel needs its own verb, or every room change becomes a journey.
   */
  it("leaves in-location movement alone", async () => {
    const intent = await parseIntent("go to the Common Room");
    expect(intent.actionType).toBe("move");
  });

  /**
   * Fail closed: a phrasing this parser cannot classify must go back for
   * clarification, never be guessed into a destination.
   */
  it("refuses to guess a destination it cannot read", async () => {
    const intent = await parseIntent("travel");
    expect(intent.actionType).toBe("mechanical_ambiguous");
  });
});

/**
 * Rest classification. The route's rest gate takes `restType` as authority, so
 * whatever this parser decides is what a character actually recovers.
 */
describe("parseIntent — rest", () => {
  it("reads a short rest", async () => {
    const intent = await parseIntent("I take a short rest");
    expect(intent.actionType).toBe("rest");
    expect(intent.restType).toBe("short");
  });

  it("reads a long rest", async () => {
    const intent = await parseIntent("I take a long rest");
    expect(intent.actionType).toBe("rest");
    expect(intent.restType).toBe("long");
  });

  it("reads the Spanish forms", async () => {
    expect((await parseIntent("descanso corto")).restType).toBe("short");
    expect((await parseIntent("descanso largo")).restType).toBe("long");
  });

  it("treats a bare rest as the short one", async () => {
    const intent = await parseIntent("rest");
    expect(intent.actionType).toBe("rest");
    expect(intent.restType).toBe("short");
  });

  /**
   * Fail closed on a sentence that names both rests.
   *
   * "not a long rest, just a short rest" used to classify as LONG: the parser
   * asks only whether the words "long rest" appear anywhere, which a negation
   * satisfies just as well as an intention. A long rest restores every spell
   * slot and steps exhaustion down, so guessing wrong in that direction hands
   * out resources the player never asked for.
   *
   * Negation parsing is not the answer — "not", "instead of", "rather than",
   * "no es un" and the rest of that space is a guessing game. Naming both
   * rests in one sentence is genuinely ambiguous, and this project already has
   * an answer for that: refuse and ask for a restatement.
   */
  it("refuses a sentence that names both rests", async () => {
    const intent = await parseIntent("not a long rest, just a short rest");
    expect(intent.actionType).toBe("mechanical_ambiguous");
  });

  it("refuses the ambiguity in Spanish too", async () => {
    const intent = await parseIntent("descanso largo no, descanso corto");
    expect(intent.actionType).toBe("mechanical_ambiguous");
  });
});
