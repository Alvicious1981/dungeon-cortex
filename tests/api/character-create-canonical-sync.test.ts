/**
 * tests/api/character-create-canonical-sync.test.ts
 *
 * Verifica que POST /api/character realiza dual-write hacia las tablas canónicas
 * CharacterAbility y CharacterSkillProficiency manteniendo integridad con stats y skillProficiencies.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/character/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    character: {
      create: vi.fn(async (args) => ({
        id: "char-canonical-test",
        ...args.data,
      })),
    },
    characterAbility: {
      createMany: vi.fn(async () => ({ count: 6 })),
    },
    characterSkillProficiency: {
      createMany: vi.fn(async () => ({ count: 2 })),
    },
    characterLanguage: {
      createMany: vi.fn(async () => ({ count: 1 })),
    },
    characterProficiency: {
      createMany: vi.fn(async () => ({ count: 8 })),
    },
    characterClassLevel: {
      create: vi.fn(async () => ({ id: "ccl-1" })),
    },
    characterOrigin: {
      create: vi.fn(async () => ({ id: "co-1" })),
    },
    characterFeature: {
      createMany: vi.fn(async () => ({ count: 2 })),
    },
    characterSpellSlot: {
      createMany: vi.fn(async () => ({ count: 1 })),
    },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(),
  AuthError: class extends Error {},
}));

vi.mock("@/lib/rules/starting-inventory", () => ({
  buildStartingInventory: vi.fn(async () => []),
}));

const STATS = { STR: 16, DEX: 14, CON: 15, INT: 10, WIS: 12, CHA: 8 };

beforeEach(() => {
  vi.clearAllMocks();
  (getAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "user-123" });
});

describe("POST /api/character — Dual-write a tablas canónicas", () => {
  it("persiste características y habilidades tanto en legacy como en tablas canónicas", async () => {
    const req = new NextRequest("http://localhost/api/character", {
      method: "POST",
      body: JSON.stringify({
        name: "Valeros",
        race: "human",
        class: "fighter",
        stats: STATS,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    // 1. Verifica creación legacy en Character
    const characterCreateCalls = (prisma.character.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(characterCreateCalls).toHaveLength(1);
    const characterData = characterCreateCalls[0][0].data;

    expect(characterData.stats).toEqual(STATS);
    expect(characterData.skillProficiencies).toEqual(["Athletics", "Perception"]);

    // 2. Verifica dual-write en CharacterAbility
    const abilityCreateCalls = (prisma.characterAbility.createMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(abilityCreateCalls).toHaveLength(1);
    const abilitiesPayload = abilityCreateCalls[0][0].data;

    expect(abilitiesPayload).toHaveLength(6);
    expect(abilitiesPayload).toContainEqual({
      characterId: "char-canonical-test",
      rulesetId: "dnd_5e_2014",
      abilityCode: "STR",
      baseScore: 16,
    });
    expect(abilitiesPayload).toContainEqual({
      characterId: "char-canonical-test",
      rulesetId: "dnd_5e_2014",
      abilityCode: "CON",
      baseScore: 15,
    });

    // 3. Verifica dual-write en CharacterSkillProficiency
    const skillCreateCalls = (prisma.characterSkillProficiency.createMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(skillCreateCalls).toHaveLength(1);
    const skillsPayload = skillCreateCalls[0][0].data;

    expect(skillsPayload).toHaveLength(2);
    expect(skillsPayload).toContainEqual({
      characterId: "char-canonical-test",
      rulesetId: "dnd_5e_2014",
      skillCode: "athletics",
      level: "PROFICIENT",
    });
    expect(skillsPayload).toContainEqual({
      characterId: "char-canonical-test",
      rulesetId: "dnd_5e_2014",
      skillCode: "perception",
      level: "PROFICIENT",
    });

    // 4. Verifica dual-write en CharacterLanguage (human -> common)
    const languageCreateCalls = (prisma.characterLanguage.createMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(languageCreateCalls).toHaveLength(1);
    const languagePayload = languageCreateCalls[0][0].data;

    expect(languagePayload).toEqual([
      {
        characterId: "char-canonical-test",
        rulesetId: "dnd_5e_2014",
        languageCode: "common",
      },
    ]);

    // 5. Verifica dual-write en CharacterProficiency (fighter -> 4 armaduras + 2 armas + 2 saves)
    const profCreateCalls = (prisma.characterProficiency.createMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(profCreateCalls).toHaveLength(1);
    const profPayload = profCreateCalls[0][0].data;

    expect(profPayload).toContainEqual({
      characterId: "char-canonical-test",
      rulesetId: "dnd_5e_2014",
      type: "ARMOR",
      code: "heavy",
    });
    expect(profPayload).toContainEqual({
      characterId: "char-canonical-test",
      rulesetId: "dnd_5e_2014",
      type: "WEAPON",
      code: "martial",
    });
    expect(profPayload).toContainEqual({
      characterId: "char-canonical-test",
      rulesetId: "dnd_5e_2014",
      type: "SAVING_THROW",
      code: "STR",
    });

    // 6. Verifica dual-write en CharacterClassLevel (fighter -> nivel 1, isPrimary: true)
    const classLevelCalls = (prisma.characterClassLevel.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(classLevelCalls).toHaveLength(1);
    const classLevelPayload = classLevelCalls[0][0].data;

    expect(classLevelPayload).toEqual({
      characterId: "char-canonical-test",
      rulesetId: "dnd_5e_2014",
      classCode: "fighter",
      subclassCode: null,
      level: 1,
      isPrimary: true,
    });

    // 7. Verifica dual-write en CharacterOrigin (human -> raceCode: "human", backgroundCode: null)
    const originCalls = (prisma.characterOrigin.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(originCalls).toHaveLength(1);
    const originPayload = originCalls[0][0].data;

    expect(originPayload).toEqual({
      characterId: "char-canonical-test",
      rulesetId: "dnd_5e_2014",
      raceCode: "human",
      backgroundCode: null,
    });

    // 8. Verifica dual-write en CharacterFeature (fighter lvl 1 -> fighting-style, second-wind)
    const featureCalls = (prisma.characterFeature.createMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(featureCalls).toHaveLength(1);
    const featurePayload = featureCalls[0][0].data;

    expect(featurePayload).toHaveLength(2);
    expect(featurePayload).toContainEqual({
      characterId: "char-canonical-test",
      rulesetId: "dnd_5e_2014",
      featureCode: "fighting-style",
      source: "class:fighter:1",
    });
    expect(featurePayload).toContainEqual({
      characterId: "char-canonical-test",
      rulesetId: "dnd_5e_2014",
      featureCode: "second-wind",
      source: "class:fighter:1",
    });
  });

  it("la creación de personaje triunfa (201) incluso si falla la sincronización canónica", async () => {
    (prisma.characterAbility.createMany as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Foreign key violation: canonical ruleset not seeded")
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const req = new NextRequest("http://localhost/api/character", {
      method: "POST",
      body: JSON.stringify({
        name: "Resilient Hero",
        race: "human",
        class: "fighter",
        stats: STATS,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("char-canonical-test");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("persiste CharacterSpellSlot para clases conjuradoras (ej. wizard)", async () => {
    const req = new NextRequest("http://localhost/api/character", {
      method: "POST",
      body: JSON.stringify({
        name: "Raistlin",
        race: "human",
        class: "wizard",
        stats: STATS,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const slotCalls = (prisma.characterSpellSlot.createMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(slotCalls).toHaveLength(1);
    const slotPayload = slotCalls[0][0].data;

    expect(slotPayload).toHaveLength(1);
    expect(slotPayload[0]).toEqual({
      characterId: "char-canonical-test",
      rulesetId: "srd-5.1",
      spellLevel: 1,
      maxSlots: 2,
      usedSlots: 0,
    });
  });
});

