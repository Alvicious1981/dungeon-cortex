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
    await expect(parseIntent(input, "ignored prompt")).resolves.toMatchObject({
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
    await expect(parseIntent(input, "ignored")).resolves.toMatchObject({
      actionType: "cast_spell",
      targetName,
    });
  });

  it("extracts an SRD spell, slot level, and target", async () => {
    getSpellInfo.mockResolvedValue({ name: "Fireball", level: 3 });
    await expect(
      parseIntent("cast Fireball at level 3 on goblin", "ignored")
    ).resolves.toMatchObject({
      actionType: "cast_spell",
      spellName: "Fireball",
      spellLevel: 3,
      targetName: "goblin",
      spellEffect: { level: 3 },
    });
  });

  it("keeps non-mechanical roleplay as general narration", async () => {
    await expect(parseIntent("I greet the innkeeper", "ignored")).resolves.toEqual({
      actionType: "general",
    });
    await expect(
      parseIntent("I tell the innkeeper I am ready", "ignored")
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
      await expect(parseIntent(input, "ignored")).resolves.toEqual({
        actionType: "ability_check",
        skill,
        band,
      });
    }
  );

  it("gives one skill different difficulties depending on the task", async () => {
    // The point of keying difficulty to the verb: Athletics used to be a single
    // value, so hauling a portcullis and hopping a fence were equally hard.
    const bandFor = async (input: string) =>
      (await parseIntent(input, "ignored")).band;

    expect(await bandFor("I climb the wall")).toBe("easy");
    expect(await bandFor("I push the cart")).toBe("medium");
    expect(await bandFor("I force the door")).toBe("hard");
  });

  it("never lets an improvised check shadow a dedicated mechanic", async () => {
    // "attack" has its own gate and must keep it.
    await expect(parseIntent("attack the goblin", "ignored")).resolves.toMatchObject({
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
      await expect(parseIntent(input, "ignored")).resolves.toEqual({
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
    "I travel to the north",
    "viajo al norte",
  ])("refuses %s rather than narrating an unresolved action", async (input) => {
    await expect(parseIntent(input, "ignored")).resolves.toEqual({
      actionType: "mechanical_ambiguous",
    });
  });

  it("no longer emits a classification that no gate consumes", async () => {
    // Guarded structurally in tests/architecture/intent-gate-exhaustiveness.test.ts;
    // asserted here too so the schema change itself is deliberate.
    const options = IntentSchema.shape.actionType.options as readonly string[];
    expect(options).not.toContain("explore");
    expect(options).not.toContain("travel");
  });

  it("reaches cantrips, which the slot-level bound used to make unrepresentable", async () => {
    getSpellInfo.mockResolvedValue({ name: "Fire Bolt", level: 0 });
    await expect(
      parseIntent("cast Fire Bolt at level 0 on goblin", "ignored")
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
      parseIntent("I poison the goblin", "ignored")
    ).resolves.toEqual({
      actionType: "mechanical_ambiguous",
    });
    await expect(
      parseIntent("I sabotage the mechanism somehow", "ignored")
    ).resolves.toEqual({
      actionType: "mechanical_ambiguous",
    });
  });
});
