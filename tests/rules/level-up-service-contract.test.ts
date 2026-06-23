import { beforeEach, describe, expect, it, vi } from "vitest";
import { xpForLevel } from "@/lib/rules/progression";

type CharacterFixture = {
  id: string;
  campaignId: string;
  xp: number;
  level: number;
  class: string;
  stats: Record<string, number>;
  hp: number;
  maxHp: number;
  hitDiceTotal: number;
  hitDiceRemaining: number;
};

type LevelUpTx = {
  campaign: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  character: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  gameLog: {
    create: ReturnType<typeof vi.fn>;
  };
  ai: {
    generateText: ReturnType<typeof vi.fn>;
  };
};

type ApplyLevelUpInput = {
  campaignId: string;
  characterId: string;
  targetLevel?: number;
  source?: string;
  useAverage?: boolean;
  tx: LevelUpTx;
};

type ApplyLevelUpResult = {
  ok?: boolean;
  campaignId?: string;
  characterId?: string;
  previousLevel?: number;
  newLevel?: number;
  previousMaxHp?: number;
  newMaxHp?: number;
  previousHp?: number;
  newHp?: number;
  hpRoll?: number;
  hpGained?: number;
  previousHitDiceTotal?: number;
  newHitDiceTotal?: number;
  previousHitDiceRemaining?: number;
  newHitDiceRemaining?: number;
  previousXP?: number;
  newXP?: number;
  facts?: unknown;
  narrative?: unknown;
  text?: unknown;
};

type ApplyLevelUp = (input: ApplyLevelUpInput) => Promise<ApplyLevelUpResult>;

const baseCharacters: CharacterFixture[] = [
  {
    id: "character-1",
    campaignId: "campaign-1",
    xp: xpForLevel(2),
    level: 2,
    class: "fighter",
    stats: { STR: 14, DEX: 12, CON: 14, INT: 10, WIS: 11, CHA: 8 },
    hp: 4,
    maxHp: 10,
    hitDiceTotal: 1,
    hitDiceRemaining: 0,
  },
  {
    id: "character-2",
    campaignId: "campaign-1",
    xp: 100,
    level: 2,
    class: "cleric",
    stats: { STR: 10, DEX: 10, CON: 12, INT: 10, WIS: 16, CHA: 10 },
    hp: 8,
    maxHp: 10,
    hitDiceTotal: 1,
    hitDiceRemaining: 1,
  },
  {
    id: "character-3",
    campaignId: "campaign-2",
    xp: xpForLevel(3),
    level: 2,
    class: "wizard",
    stats: { STR: 8, DEX: 14, CON: 10, INT: 17, WIS: 12, CHA: 10 },
    hp: 9,
    maxHp: 13,
    hitDiceTotal: 2,
    hitDiceRemaining: 1,
  },
];

async function loadApplyLevelUp(): Promise<ApplyLevelUp> {
  const modulePath: string = "../../lib/rules/level-up-service";
  const mod = await import(modulePath);
  return mod.applyLevelUp as ApplyLevelUp;
}

function createTx(options?: {
  characters?: CharacterFixture[];
  campaignIds?: string[];
}) {
  const characters = (options?.characters ?? baseCharacters).map((character) => ({
    ...character,
    stats: { ...character.stats },
  }));
  const campaignIds = new Set(options?.campaignIds ?? ["campaign-1", "campaign-2"]);

  const tx: LevelUpTx = {
    campaign: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (!campaignIds.has(where.id)) return null;
        const campaignCharacter = characters.find(
          (character) => character.campaignId === where.id
        );
        return { id: where.id, characterId: campaignCharacter?.id };
      }),
    },
    character: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; campaignId?: string } }) =>
        characters.find(
          (character) =>
            (where.id === undefined || character.id === where.id) &&
            (where.campaignId === undefined || character.campaignId === where.campaignId)
        ) ?? null
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        characters.find((character) => character.id === where.id) ?? null
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<
            Pick<
              CharacterFixture,
              "xp" | "level" | "hp" | "maxHp" | "hitDiceTotal" | "hitDiceRemaining"
            >
          >;
        }) => {
          const character = characters.find((candidate) => candidate.id === where.id);
          if (!character) throw new Error(`Missing character ${where.id}`);

          Object.assign(character, data);
          return { ...character, stats: { ...character.stats } };
        }
      ),
    },
    gameLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "log-1",
        ...data,
      })),
    },
    ai: {
      generateText: vi.fn(),
    },
  };

  return { characters, tx };
}

function levelUpInput(
  tx: LevelUpTx,
  overrides?: Partial<ApplyLevelUpInput>
): ApplyLevelUpInput {
  return {
    campaignId: "campaign-1",
    characterId: "character-1",
    targetLevel: 2,
    source: "triggerLevelUp",
    useAverage: true,
    tx,
    ...overrides,
  };
}

function findCharacter(characters: CharacterFixture[], id: string): CharacterFixture {
  const character = characters.find((candidate) => candidate.id === id);
  if (!character) throw new Error(`Missing character ${id}`);
  return character;
}

async function applyValidLevelUp(applyLevelUp: ApplyLevelUp) {
  const { characters, tx } = createTx();
  const result = await applyLevelUp(levelUpInput(tx));
  return { characters, result, tx };
}

describe("applyLevelUp service contract", () => {
  let applyLevelUp: ApplyLevelUp;

  beforeEach(async () => {
    applyLevelUp = await loadApplyLevelUp();
  });

  it("rejects a missing campaign", async () => {
    const { tx } = createTx({ campaignIds: ["campaign-1"] });

    await expect(
      applyLevelUp(levelUpInput(tx, { campaignId: "missing-campaign" }))
    ).rejects.toThrow(/campaign/i);

    expect(tx.character.update).not.toHaveBeenCalled();
  });

  it("rejects a missing character", async () => {
    const { tx } = createTx();

    await expect(
      applyLevelUp(levelUpInput(tx, { characterId: "missing-character" }))
    ).rejects.toThrow(/character/i);

    expect(tx.character.update).not.toHaveBeenCalled();
  });

  it("rejects a character from another campaign", async () => {
    const { tx } = createTx();

    await expect(
      applyLevelUp(
        levelUpInput(tx, {
          campaignId: "campaign-1",
          characterId: "character-3",
        })
      )
    ).rejects.toThrow(/campaign|character/i);

    expect(tx.character.update).not.toHaveBeenCalled();
  });

  it("rejects level-up when XP is below the next 5e threshold", async () => {
    const { tx } = createTx({
      characters: [{ ...baseCharacters[0], xp: xpForLevel(2) - 1 }],
    });

    await expect(applyLevelUp(levelUpInput(tx))).rejects.toThrow(/xp|level/i);

    expect(tx.character.update).not.toHaveBeenCalled();
  });

  it("rejects lowering a level", async () => {
    const { tx } = createTx({
      characters: [{ ...baseCharacters[0], xp: xpForLevel(2), level: 2 }],
    });

    await expect(
      applyLevelUp(levelUpInput(tx, { targetLevel: 1 }))
    ).rejects.toThrow(/level/i);

    expect(tx.character.update).not.toHaveBeenCalled();
  });

  it("rejects invalid jumps when the service allows only one level per call", async () => {
    const { tx } = createTx({
      characters: [{ ...baseCharacters[0], xp: xpForLevel(3), level: 2 }],
    });

    await expect(
      applyLevelUp(levelUpInput(tx, { targetLevel: 3 }))
    ).rejects.toThrow(/level/i);

    expect(tx.character.update).not.toHaveBeenCalled();
  });

  it("applies exactly one pending physical level-up for a valid character", async () => {
    const { characters, result } = await applyValidLevelUp(applyLevelUp);

    expect(findCharacter(characters, "character-1").level).toBe(2);
    expect(result).toMatchObject({
      previousLevel: 1,
      newLevel: 2,
    });
  });

  it("preserves the level already persisted by the XP award service", async () => {
    const { characters, tx } = await applyValidLevelUp(applyLevelUp);
    const updateData = tx.character.update.mock.calls[0]?.[0]?.data ?? {};

    expect(findCharacter(characters, "character-1").level).toBe(2);
    expect(updateData).not.toHaveProperty("level");
  });

  it("updates maxHp deterministically from class hit die average plus CON modifier", async () => {
    const { characters, result } = await applyValidLevelUp(applyLevelUp);

    expect(findCharacter(characters, "character-1").maxHp).toBe(18);
    expect(result).toMatchObject({
      previousMaxHp: 10,
      newMaxHp: 18,
      hpGained: 8,
    });
  });

  it("updates hp according to the existing project rule: full heal to new maxHp", async () => {
    const { characters, result } = await applyValidLevelUp(applyLevelUp);

    expect(findCharacter(characters, "character-1").hp).toBe(18);
    expect(result).toMatchObject({
      previousHp: 4,
      newHp: 18,
    });
  });

  it("updates hitDiceTotal to the new level", async () => {
    const { characters, result } = await applyValidLevelUp(applyLevelUp);

    expect(findCharacter(characters, "character-1").hitDiceTotal).toBe(2);
    expect(result).toMatchObject({
      previousHitDiceTotal: 1,
      newHitDiceTotal: 2,
    });
  });

  it("updates hitDiceRemaining according to the existing project rule: reset to total", async () => {
    const { characters, result } = await applyValidLevelUp(applyLevelUp);

    expect(findCharacter(characters, "character-1").hitDiceRemaining).toBe(2);
    expect(result).toMatchObject({
      previousHitDiceRemaining: 0,
      newHitDiceRemaining: 2,
    });
  });

  it("does not touch other characters in the same campaign", async () => {
    const { characters } = await applyValidLevelUp(applyLevelUp);

    expect(findCharacter(characters, "character-2")).toMatchObject(baseCharacters[1]);
  });

  it("does not touch another campaign", async () => {
    const { characters } = await applyValidLevelUp(applyLevelUp);

    expect(findCharacter(characters, "character-3")).toMatchObject(baseCharacters[2]);
  });

  it("does not modify XP while applying level-up mechanics", async () => {
    const { characters, result, tx } = await applyValidLevelUp(applyLevelUp);
    const updateData = tx.character.update.mock.calls[0]?.[0]?.data ?? {};

    expect(findCharacter(characters, "character-1").xp).toBe(xpForLevel(2));
    expect(updateData).not.toHaveProperty("xp");
    expect(result).toMatchObject({
      previousXP: xpForLevel(2),
      newXP: xpForLevel(2),
    });
  });

  it("returns structured facts for narration and UI", async () => {
    const { result } = await applyValidLevelUp(applyLevelUp);

    expect(result.facts ?? result).toEqual(
      expect.objectContaining({
        campaignId: "campaign-1",
        characterId: "character-1",
        previousLevel: 1,
        newLevel: 2,
        previousMaxHp: 10,
        newMaxHp: 18,
      })
    );
  });

  it("does not return narrative prose", async () => {
    const { result } = await applyValidLevelUp(applyLevelUp);

    expect(result.narrative).toBeUndefined();
    expect(result.text).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/\b(narrates?|prose|flourish)\b/i);
  });

  it("does not call AI providers", async () => {
    const { tx } = await applyValidLevelUp(applyLevelUp);

    expect(tx.ai.generateText).not.toHaveBeenCalled();
  });

  it("does not introduce forbidden retro progression rules", async () => {
    const forbiddenTerms = [
      ["TH", "AC", "0"].join(""),
      ["descending", "AC"].join(" "),
      ["AC", "descendente"].join(" "),
      ["saving", "throw", "vs"].join(" "),
      ["save", "vs", "death"].join(" "),
      ["save", "vs", "wands"].join(" "),
      ["gold", "for", "XP"].join(" "),
      ["XP", "por", "oro"].join(" "),
      ["AD", "&", "D"].join(""),
      ["OS", "R"].join(""),
    ];
    const { result, tx } = await applyValidLevelUp(applyLevelUp);
    const serialized = JSON.stringify({
      result,
      updates: tx.character.update.mock.calls,
      logs: tx.gameLog.create.mock.calls,
    });

    for (const term of forbiddenTerms) {
      expect(serialized).not.toContain(term);
    }
  });

  it("respects the existing 5e/SRD 2014 progression threshold table", async () => {
    const { characters, result } = await applyValidLevelUp(applyLevelUp);

    expect(findCharacter(characters, "character-1")).toMatchObject({
      xp: xpForLevel(2),
      level: 2,
    });
    expect(result.newLevel).toBe(2);
  });
});
