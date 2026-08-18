import { beforeEach, describe, expect, it, vi } from "vitest";

const getSpellInfo = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/tools/srd-lookup", () => ({ getSpellInfo }));

import { parseIntent } from "@/lib/ai/intent";

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
    ["I push the boulder", "Athletics"],
    ["empujo la roca", "Athletics"],
    ["I try to disarm the goblin", "Athletics"],
    ["intento desarmar al goblin", "Athletics"],
    ["I attempt to climb the wall", "Athletics"],
    ["I sneak past the guard", "Stealth"],
    ["I lie to the guard", "Deception"],
    ["miento al guardia", "Deception"],
    ["I intimidate the merchant", "Intimidation"],
    ["I persuade the innkeeper", "Persuasion"],
    ["I examine the runes", "Investigation"],
    ["I listen at the door", "Perception"],
  ])("adjudicates %s as an improvised skill check", async (input, skill) => {
    await expect(parseIntent(input, "ignored")).resolves.toEqual({
      actionType: "ability_check",
      skill,
    });
  });

  it("never lets an improvised check shadow a dedicated mechanic", async () => {
    // "attack" and "search" have their own gates and must keep them.
    await expect(parseIntent("attack the goblin", "ignored")).resolves.toMatchObject({
      actionType: "attack",
    });
    await expect(parseIntent("I search the room", "ignored")).resolves.toMatchObject({
      actionType: "explore",
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
