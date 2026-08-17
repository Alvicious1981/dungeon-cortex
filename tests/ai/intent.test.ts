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

  it("flags an unsupported mechanical action for structured clarification", async () => {
    await expect(
      parseIntent("I try to disarm the goblin", "ignored")
    ).resolves.toEqual({
      actionType: "mechanical_ambiguous",
    });
    await expect(
      parseIntent("I poison the goblin", "ignored")
    ).resolves.toEqual({
      actionType: "mechanical_ambiguous",
    });
  });
});
