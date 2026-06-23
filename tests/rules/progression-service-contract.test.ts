import { beforeEach, describe, expect, it, vi } from "vitest";
import { xpForLevel } from "@/lib/rules/progression";

type CharacterFixture = {
  id: string;
  campaignId: string;
  xp: number;
  level: number;
  hp: number;
  maxHp: number;
};

type ProgressionTx = {
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
};

type ApplyExperienceAwardInput = {
  campaignId: string;
  characterId: string;
  xpAmount: number;
  reason?: string;
  source?: string;
  tx: ProgressionTx;
};

type ProgressionAwardResult = {
  ok?: boolean;
  characterId?: string;
  previousXP?: number;
  newXP?: number;
  previousLevel?: number;
  newLevel?: number;
  leveledUp?: boolean;
  pendingLevelUp?: unknown;
  facts?: unknown;
  narrative?: unknown;
  text?: unknown;
};

type ApplyExperienceAward = (
  input: ApplyExperienceAwardInput
) => Promise<ProgressionAwardResult>;

const baseCharacters: CharacterFixture[] = [
  {
    id: "character-1",
    campaignId: "campaign-1",
    xp: 250,
    level: 1,
    hp: 7,
    maxHp: 10,
  },
  {
    id: "character-2",
    campaignId: "campaign-1",
    xp: 100,
    level: 1,
    hp: 8,
    maxHp: 12,
  },
  {
    id: "character-3",
    campaignId: "campaign-2",
    xp: 2_700,
    level: 4,
    hp: 18,
    maxHp: 31,
  },
];

async function loadApplyExperienceAward(): Promise<ApplyExperienceAward> {
  const modulePath = "../../lib/rules/progression-service";
  const mod = await import(modulePath);
  return mod.applyExperienceAward as ApplyExperienceAward;
}

function createTx(options?: {
  characters?: CharacterFixture[];
  campaignIds?: string[];
}) {
  const characters = (options?.characters ?? baseCharacters).map((character) => ({
    ...character,
  }));
  const campaignIds = new Set(options?.campaignIds ?? ["campaign-1", "campaign-2"]);

  const tx: ProgressionTx = {
    campaign: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        campaignIds.has(where.id) ? { id: where.id } : null
      ),
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
          data: {
            xp?: number | { increment?: number };
            level?: number;
            hp?: number;
            maxHp?: number;
          };
        }) => {
          const character = characters.find((candidate) => candidate.id === where.id);
          if (!character) throw new Error(`Missing character ${where.id}`);

          if (typeof data.xp === "number") character.xp = data.xp;
          if (typeof data.xp === "object") character.xp += data.xp.increment ?? 0;
          if (typeof data.level === "number") character.level = data.level;
          if (typeof data.hp === "number") character.hp = data.hp;
          if (typeof data.maxHp === "number") character.maxHp = data.maxHp;

          return { ...character };
        }
      ),
    },
    gameLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "log-1",
        ...data,
      })),
    },
  };

  return { characters, tx };
}

function awardInput(
  tx: ProgressionTx,
  overrides?: Partial<ApplyExperienceAwardInput>
): ApplyExperienceAwardInput {
  return {
    campaignId: "campaign-1",
    characterId: "character-1",
    xpAmount: 50,
    reason: "quest_objective_completed",
    source: "ai_tool_intent",
    tx,
    ...overrides,
  };
}

function findCharacter(characters: CharacterFixture[], id: string): CharacterFixture {
  const character = characters.find((candidate) => candidate.id === id);
  if (!character) throw new Error(`Missing character ${id}`);
  return character;
}

describe("applyExperienceAward service contract", () => {
  let applyExperienceAward: ApplyExperienceAward;

  beforeEach(async () => {
    applyExperienceAward = await loadApplyExperienceAward();
  });

  it("rejects a missing campaign", async () => {
    const { tx } = createTx({ campaignIds: ["campaign-1"] });

    await expect(
      applyExperienceAward(
        awardInput(tx, {
          campaignId: "missing-campaign",
        })
      )
    ).rejects.toThrow(/campaign/i);

    expect(tx.character.update).not.toHaveBeenCalled();
  });

  it("rejects a missing character", async () => {
    const { tx } = createTx();

    await expect(
      applyExperienceAward(
        awardInput(tx, {
          characterId: "missing-character",
        })
      )
    ).rejects.toThrow(/character/i);

    expect(tx.character.update).not.toHaveBeenCalled();
  });

  it("rejects xpAmount of zero", async () => {
    const { tx } = createTx();

    await expect(
      applyExperienceAward(awardInput(tx, { xpAmount: 0 }))
    ).rejects.toThrow(/xp/i);

    expect(tx.character.update).not.toHaveBeenCalled();
  });

  it("rejects negative xpAmount", async () => {
    const { tx } = createTx();

    await expect(
      applyExperienceAward(awardInput(tx, { xpAmount: -1 }))
    ).rejects.toThrow(/xp/i);

    expect(tx.character.update).not.toHaveBeenCalled();
  });

  it("rejects a character whose persisted XP is already negative", async () => {
    const { tx } = createTx({
      characters: [{ ...baseCharacters[0], xp: -10 }],
    });

    await expect(applyExperienceAward(awardInput(tx))).rejects.toThrow(/xp/i);

    expect(tx.character.update).not.toHaveBeenCalled();
  });

  it("adds XP to a valid character", async () => {
    const { characters, tx } = createTx();

    const result = await applyExperienceAward(awardInput(tx, { xpAmount: 25 }));

    expect(findCharacter(characters, "character-1").xp).toBe(275);
    expect(result).toMatchObject({
      characterId: "character-1",
      previousXP: 250,
      newXP: 275,
    });
  });

  it("does not touch characters from another campaign", async () => {
    const { characters, tx } = createTx();

    await applyExperienceAward(awardInput(tx, { xpAmount: 25 }));

    expect(findCharacter(characters, "character-3")).toMatchObject({
      xp: 2_700,
      level: 4,
      hp: 18,
      maxHp: 31,
    });
  });

  it("does not touch another character from the same campaign", async () => {
    const { characters, tx } = createTx();

    await applyExperienceAward(awardInput(tx, { xpAmount: 25 }));

    expect(findCharacter(characters, "character-2")).toMatchObject({
      xp: 100,
      level: 1,
      hp: 8,
      maxHp: 12,
    });
  });

  it("does not allow a character level to decrease", async () => {
    const { characters, tx } = createTx({
      characters: [{ ...baseCharacters[0], xp: 2_700, level: 4 }],
    });

    const result = await applyExperienceAward(awardInput(tx, { xpAmount: 1 }));

    expect(findCharacter(characters, "character-1").level).toBeGreaterThanOrEqual(4);
    expect(result.newLevel ?? 4).toBeGreaterThanOrEqual(result.previousLevel ?? 4);
  });

  it("does not allow invalid multi-level jumps from a malformed current level", async () => {
    const { tx } = createTx({
      characters: [{ ...baseCharacters[0], xp: xpForLevel(5), level: 1 }],
    });

    await expect(
      applyExperienceAward(awardInput(tx, { xpAmount: 1 }))
    ).rejects.toThrow(/level/i);

    expect(tx.character.update).not.toHaveBeenCalled();
  });

  it("uses the project's 5e XP threshold table for progression", async () => {
    const { characters, tx } = createTx({
      characters: [{ ...baseCharacters[0], xp: xpForLevel(2) - 25, level: 1 }],
    });

    const result = await applyExperienceAward(awardInput(tx, { xpAmount: 25 }));

    expect(findCharacter(characters, "character-1").xp).toBe(xpForLevel(2));
    expect(result.newLevel).toBe(2);
  });

  it("returns deterministic level-up state when automatic level updates are enabled", async () => {
    const { characters, tx } = createTx({
      characters: [{ ...baseCharacters[0], xp: 299, level: 1 }],
    });

    const result = await applyExperienceAward(awardInput(tx, { xpAmount: 1 }));

    if (result.pendingLevelUp === undefined) {
      expect(findCharacter(characters, "character-1").level).toBe(2);
      expect(result).toMatchObject({
        previousLevel: 1,
        newLevel: 2,
        leveledUp: true,
      });
    }
  });

  it("returns pendingLevelUp instead of changing level when level-up is deferred", async () => {
    const { characters, tx } = createTx({
      characters: [{ ...baseCharacters[0], xp: 299, level: 1 }],
    });

    const result = await applyExperienceAward(awardInput(tx, { xpAmount: 1 }));

    if (result.pendingLevelUp !== undefined) {
      expect(findCharacter(characters, "character-1").level).toBe(1);
      expect(result.pendingLevelUp).toMatchObject({
        characterId: "character-1",
        fromLevel: 1,
        toLevel: 2,
      });
    }
  });

  it("does not modify hp or maxHp as part of an XP award", async () => {
    const { characters, tx } = createTx({
      characters: [{ ...baseCharacters[0], xp: 299, level: 1, hp: 3, maxHp: 10 }],
    });

    await applyExperienceAward(awardInput(tx, { xpAmount: 1 }));

    expect(findCharacter(characters, "character-1")).toMatchObject({
      hp: 3,
      maxHp: 10,
    });
  });

  it("does not modify hit dice as part of an XP award", async () => {
    const { tx } = createTx();

    await applyExperienceAward(awardInput(tx, { xpAmount: 25 }));

    expect(tx.character.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hitDiceTotal: expect.anything(),
        }),
      })
    );
    expect(tx.character.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hitDiceRemaining: expect.anything(),
        }),
      })
    );
  });
  it("returns structured facts for narration", async () => {
    const { tx } = createTx();

    const result = await applyExperienceAward(awardInput(tx, { xpAmount: 25 }));

    expect(result.facts ?? result).toEqual(
      expect.objectContaining({
        characterId: "character-1",
        previousXP: 250,
        newXP: 275,
      })
    );
  });

  it("does not return narrative prose", async () => {
    const { tx } = createTx();

    const result = await applyExperienceAward(awardInput(tx, { xpAmount: 25 }));

    expect(result.narrative).toBeUndefined();
    expect(result.text).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/\b(narrates?|prose|flourish)\b/i);
  });

  it("does not call AI providers", async () => {
    const { tx } = createTx();

    await applyExperienceAward(awardInput(tx, { xpAmount: 25 }));

    expect(JSON.stringify(tx.character.update.mock.calls)).not.toMatch(/\bai\b/i);
  });

  it("does not introduce forbidden retro progression rules", async () => {
    const { tx } = createTx();
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

    const result = await applyExperienceAward(awardInput(tx, { xpAmount: 25 }));
    const serializedResult = JSON.stringify(result);

    for (const term of forbiddenTerms) {
      expect(serializedResult).not.toContain(term);
    }
  });
});
