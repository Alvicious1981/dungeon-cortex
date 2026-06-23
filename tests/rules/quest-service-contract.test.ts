import { beforeEach, describe, expect, it, vi } from "vitest";

type QuestStatus = "active" | "completed" | "failed";

type CampaignFixture = {
  id: string;
};

type QuestFixture = {
  id: string;
  campaignId: string;
  title: string;
  description: string;
  status: QuestStatus;
  giverId?: string | null;
  location?: string | null;
  hook?: string | null;
  objective?: string | null;
  reward?: string | null;
};

type QuestDescriptorFixture = {
  title: string;
  description: string;
  giverId?: string;
  location?: string;
  hook?: string;
  objective?: string;
  reward?: string;
};

type QuestTx = {
  campaign: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  quest: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

type UpdateQuestStatusInput = {
  campaignId: string;
  questId: string;
  status: QuestStatus | string;
  reason?: string;
  tx: QuestTx;
};

type CreateTrackedQuestInput = {
  campaignId: string;
  seed?: number;
  context?: string;
  descriptor?: QuestDescriptorFixture;
  tx: QuestTx;
};

type QuestServiceResult = {
  ok?: boolean;
  questId?: string;
  campaignId?: string;
  status?: QuestStatus;
  facts?: unknown;
  narrative?: unknown;
  text?: unknown;
  prose?: unknown;
  message?: unknown;
};

type UpdateQuestStatus = (
  input: UpdateQuestStatusInput
) => Promise<QuestServiceResult>;

type CreateTrackedQuest = (
  input: CreateTrackedQuestInput
) => Promise<QuestServiceResult>;

const baseCampaigns: CampaignFixture[] = [
  { id: "campaign-1" },
  { id: "campaign-2" },
];

const baseQuests: QuestFixture[] = [
  {
    id: "quest-1",
    campaignId: "campaign-1",
    title: "The Silent Well",
    description: "The village well has run black for three days.",
    status: "active",
    hook: "The village well has run black for three days.",
    objective: "Find the source of the corruption.",
    reward: "A letter of introduction.",
  },
  {
    id: "quest-2",
    campaignId: "campaign-1",
    title: "The Absent Patrol",
    description: "The patrol has not returned.",
    status: "active",
  },
  {
    id: "quest-3",
    campaignId: "campaign-2",
    title: "The Empty Hold",
    description: "A merchant ship docked with no crew.",
    status: "active",
  },
];

async function loadQuestService(): Promise<{
  updateQuestStatus: UpdateQuestStatus;
  createTrackedQuest: CreateTrackedQuest;
}> {
  const modulePath = "../../lib/rules/quest-service";
  const mod = await import(modulePath);
  return {
    updateQuestStatus: mod.updateQuestStatus as UpdateQuestStatus,
    createTrackedQuest: mod.createTrackedQuest as CreateTrackedQuest,
  };
}

function createTx(options?: {
  campaigns?: CampaignFixture[];
  quests?: QuestFixture[];
}) {
  const campaigns = (options?.campaigns ?? baseCampaigns).map((campaign) => ({
    ...campaign,
  }));
  const quests = (options?.quests ?? baseQuests).map((quest) => ({
    ...quest,
  }));

  const tx: QuestTx = {
    campaign: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        campaigns.find((campaign) => campaign.id === where.id) ?? null
      ),
    },
    quest: {
      findFirst: vi.fn(async ({ where }: { where: Partial<QuestFixture> }) =>
        quests.find((quest) => matchesQuestWhere(quest, where)) ?? null
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        quests.find((quest) => quest.id === where.id) ?? null
      ),
      create: vi.fn(async ({ data }: { data: Omit<QuestFixture, "id"> }) => {
        const quest = {
          id: `created-quest-${quests.length + 1}`,
          ...data,
        };
        quests.push(quest);
        return { ...quest };
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Pick<QuestFixture, "status">>;
        }) => {
          const quest = quests.find((candidate) => candidate.id === where.id);
          if (!quest) throw new Error(`Missing quest ${where.id}`);
          if (data.status !== undefined) quest.status = data.status;
          return { ...quest };
        }
      ),
    },
  };

  return { campaigns, quests, tx };
}

function matchesQuestWhere(quest: QuestFixture, where: Partial<QuestFixture>): boolean {
  return Object.entries(where).every(
    ([key, expected]) => quest[key as keyof QuestFixture] === expected
  );
}

function statusInput(
  tx: QuestTx,
  overrides?: Partial<UpdateQuestStatusInput>
): UpdateQuestStatusInput {
  return {
    campaignId: "campaign-1",
    questId: "quest-1",
    status: "completed",
    reason: "objective_resolved",
    tx,
    ...overrides,
  };
}

function createInput(
  tx: QuestTx,
  overrides?: Partial<CreateTrackedQuestInput>
): CreateTrackedQuestInput {
  return {
    campaignId: "campaign-1",
    seed: 1234,
    context: "bounty_board",
    descriptor: {
      title: "The Locked Vestry",
      description: "The priest was found dead in a locked vestry.",
      hook: "The priest was found dead in a locked vestry.",
      location: "the chapel",
      objective: "Find the killer.",
      reward: "A favor from the city guard.",
    },
    tx,
    ...overrides,
  };
}

function findQuest(quests: QuestFixture[], id: string): QuestFixture {
  const quest = quests.find((candidate) => candidate.id === id);
  if (!quest) throw new Error(`Missing quest ${id}`);
  return quest;
}

function expectStructuredFacts(result: QuestServiceResult) {
  expect(result).toMatchObject({ ok: true });
  expect(result.facts ?? result).toEqual(expect.any(Object));
}

function expectNoNarrativeText(result: QuestServiceResult) {
  expect(result.narrative).toBeUndefined();
  expect(result.text).toBeUndefined();
  expect(result.prose).toBeUndefined();
  expect(result.message).toBeUndefined();
  expect(JSON.stringify(result)).not.toMatch(
    /\b(narration|narrative|prose|flavorText|boxed text)\b/i
  );
}

function expectNoForbiddenRetroTerms(result: unknown) {
  expect(JSON.stringify(result)).not.toMatch(
    /AD&D|OSR|THAC0|descending AC|AC descendente|saving throw vs|save vs death|gold for XP|XP por oro/i
  );
}

describe("quest-service contract", () => {
  let updateQuestStatus: UpdateQuestStatus;
  let createTrackedQuest: CreateTrackedQuest;

  beforeEach(async () => {
    ({ updateQuestStatus, createTrackedQuest } = await loadQuestService());
  });

  describe("updateQuestStatus", () => {
    it("rejects a missing campaign", async () => {
      const { tx } = createTx({ campaigns: [] });

      await expect(updateQuestStatus(statusInput(tx))).rejects.toMatchObject({
        code: "CAMPAIGN_NOT_FOUND",
      });

      expect(tx.quest.update).not.toHaveBeenCalled();
    });

    it("rejects a missing quest", async () => {
      const { tx } = createTx({ quests: [] });

      await expect(updateQuestStatus(statusInput(tx))).rejects.toMatchObject({
        code: "QUEST_NOT_FOUND",
      });

      expect(tx.quest.update).not.toHaveBeenCalled();
    });

    it("rejects a quest from another campaign", async () => {
      const { tx } = createTx();

      await expect(
        updateQuestStatus(statusInput(tx, { questId: "quest-3" }))
      ).rejects.toMatchObject({ code: "QUEST_OWNERSHIP_MISMATCH" });

      expect(tx.quest.update).not.toHaveBeenCalled();
    });

    it("rejects an invalid status", async () => {
      const { tx } = createTx();

      await expect(
        updateQuestStatus(statusInput(tx, { status: "archived" }))
      ).rejects.toMatchObject({ code: "INVALID_QUEST_STATUS" });

      expect(tx.quest.update).not.toHaveBeenCalled();
    });

    it("updates a valid status", async () => {
      const { quests, tx } = createTx();

      const result = await updateQuestStatus(statusInput(tx, { status: "completed" }));

      expect(findQuest(quests, "quest-1").status).toBe("completed");
      expect(result).toMatchObject({
        ok: true,
        campaignId: "campaign-1",
        questId: "quest-1",
        status: "completed",
      });
    });

    it("does not touch quests from another campaign", async () => {
      const { quests, tx } = createTx();

      await updateQuestStatus(statusInput(tx, { status: "failed" }));

      expect(findQuest(quests, "quest-3").status).toBe("active");
    });

    it("does not touch other quests from the same campaign", async () => {
      const { quests, tx } = createTx();

      await updateQuestStatus(statusInput(tx, { status: "failed" }));

      expect(findQuest(quests, "quest-2").status).toBe("active");
    });

    it("returns structured facts", async () => {
      const { tx } = createTx();

      const result = await updateQuestStatus(statusInput(tx));

      expectStructuredFacts(result);
      expect(result.facts ?? result).toEqual(
        expect.objectContaining({
          questId: "quest-1",
          campaignId: "campaign-1",
          status: "completed",
        })
      );
    });

    it("does not return narrative text", async () => {
      const { tx } = createTx();

      const result = await updateQuestStatus(statusInput(tx));

      expectNoNarrativeText(result);
    });

    it("does not call AI", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const { tx } = createTx();

      await updateQuestStatus(statusInput(tx));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("does not introduce forbidden retro rules or jargon", async () => {
      const { tx } = createTx();

      const result = await updateQuestStatus(statusInput(tx));

      expectNoForbiddenRetroTerms(result);
    });
  });

  describe("createTrackedQuest", () => {
    it("rejects a missing campaign", async () => {
      const { tx } = createTx({ campaigns: [] });

      await expect(createTrackedQuest(createInput(tx))).rejects.toMatchObject({
        code: "CAMPAIGN_NOT_FOUND",
      });

      expect(tx.quest.create).not.toHaveBeenCalled();
    });

    it("creates a valid quest for the requested campaign", async () => {
      const { quests, tx } = createTx();

      const result = await createTrackedQuest(createInput(tx));

      expect(quests.at(-1)).toMatchObject({
        campaignId: "campaign-1",
        title: "The Locked Vestry",
        description: "The priest was found dead in a locked vestry.",
        status: "active",
      });
      expect(result).toMatchObject({
        ok: true,
        campaignId: "campaign-1",
        questId: expect.any(String),
      });
    });

    it("uses deterministic generated quest data or a validated descriptor", async () => {
      const { tx } = createTx();

      await createTrackedQuest(createInput(tx));

      expect(tx.quest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "The Locked Vestry",
            hook: "The priest was found dead in a locked vestry.",
            objective: "Find the killer.",
            reward: "A favor from the city guard.",
          }),
        })
      );
    });

    it("does not create a quest without campaignId", async () => {
      const { tx } = createTx();

      await expect(
        createTrackedQuest(createInput(tx, { campaignId: "" }))
      ).rejects.toMatchObject({ code: "CAMPAIGN_NOT_FOUND" });

      expect(tx.quest.create).not.toHaveBeenCalled();
    });

    it("does not create a quest with an invalid payload", async () => {
      const { tx } = createTx();

      await expect(
        createTrackedQuest(
          createInput(tx, {
            descriptor: {
              title: "",
              description: "Missing a title.",
            },
          })
        )
      ).rejects.toMatchObject({ code: "INVALID_QUEST_PAYLOAD" });

      expect(tx.quest.create).not.toHaveBeenCalled();
    });

    it("returns structured facts", async () => {
      const { tx } = createTx();

      const result = await createTrackedQuest(createInput(tx));

      expectStructuredFacts(result);
      expect(result.facts ?? result).toEqual(
        expect.objectContaining({
          campaignId: "campaign-1",
          status: "active",
        })
      );
    });

    it("does not return narrative text", async () => {
      const { tx } = createTx();

      const result = await createTrackedQuest(createInput(tx));

      expectNoNarrativeText(result);
    });

    it("does not call AI", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const { tx } = createTx();

      await createTrackedQuest(createInput(tx));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("does not introduce forbidden retro rules or jargon", async () => {
      const { tx } = createTx();

      const result = await createTrackedQuest(createInput(tx));

      expectNoForbiddenRetroTerms(result);
    });
  });
});
