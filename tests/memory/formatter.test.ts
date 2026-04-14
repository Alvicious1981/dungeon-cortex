/**
 * tests/memory/formatter.test.ts
 *
 * Tests for Iron Laws mandates added in Milestone K.
 * Verifies that formatSystemPrompt injects the Loot Generation Mandate
 * and the Victory trigger section when the encounter is resolved.
 */

import { describe, it, expect } from "vitest";
import { formatSystemPrompt } from "@/lib/memory/formatter";
import type { CampaignContext } from "@/lib/memory/context";

// ---------------------------------------------------------------------------
// Minimal context fixtures
// ---------------------------------------------------------------------------

const baseCharacter: CampaignContext["character"] = {
  id: "char-1",
  name: "Thalindra",
  race: "Elf",
  class: "wizard",
  level: 5,
  hp: 28,
  maxHp: 32,
  xp: 6500,
  stats: { STR: 8, DEX: 14, CON: 12, INT: 18, WIS: 14, CHA: 10 },
  spellSlots: null,
  concentrationSpellId: null,
  hitDiceTotal: 5,
  hitDiceRemaining: 3,
  inventory: [],
};

const baseContext: CampaignContext = {
  character: baseCharacter,
  activeEncounter: null,
  recentLogs: [],
  relevantMemories: [],
  quests: [],
  currentExploration: null,
};

const resolvedEncounter: CampaignContext["activeEncounter"] = {
  id: "enc-resolved-01",
  round: 4,
  currentTurnIndex: 0,
  status: "resolved",
  tensionScore: 0.73,
  reason: "all_enemies_dead",
  combatants: [
    {
      id: "cbt-player",
      name: "Thalindra",
      isPlayer: true,
      hp: 20,
      maxHp: 32,
      ac: 14,
      initiativeTotal: 18,
      conditions: [],
    },
    {
      id: "cbt-goblin",
      name: "Goblin",
      isPlayer: false,
      hp: 0,
      maxHp: 7,
      ac: 15,
      initiativeTotal: 10,
      conditions: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Loot Generation Mandate
// ---------------------------------------------------------------------------

describe("formatSystemPrompt — Loot Generation Mandate", () => {
  it("includes 'Loot Generation Mandate' in the system prompt", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).toContain("Loot Generation Mandate");
  });

  it("mandates calling generateLoot when all enemies are dead", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).toContain("generateLoot");
  });

  it("prohibits inventing gold or items", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt.toLowerCase()).toMatch(/never invent.*gold|gold.*never invent/);
  });
});

// ---------------------------------------------------------------------------
// Victory trigger section
// ---------------------------------------------------------------------------

describe("formatSystemPrompt — Victory trigger section", () => {
  it("includes VICTORY section when encounter is resolved with all_enemies_dead", () => {
    const ctx: CampaignContext = {
      ...baseContext,
      activeEncounter: resolvedEncounter,
    };
    const prompt = formatSystemPrompt(ctx);
    expect(prompt).toContain("VICTORY");
  });

  it("includes the tensionScore in the Victory section", () => {
    const ctx: CampaignContext = {
      ...baseContext,
      activeEncounter: resolvedEncounter,
    };
    const prompt = formatSystemPrompt(ctx);
    expect(prompt).toContain("0.73");
  });

  it("includes MANDATORY generateLoot call instruction in Victory section", () => {
    const ctx: CampaignContext = {
      ...baseContext,
      activeEncounter: resolvedEncounter,
    };
    const prompt = formatSystemPrompt(ctx);
    expect(prompt).toContain("generateLoot");
    expect(prompt).toContain("MANDATORY");
  });

  it("does NOT include the Victory section when encounter is active", () => {
    const activeEncounter: CampaignContext["activeEncounter"] = {
      ...resolvedEncounter,
      status: "active",
      reason: undefined,
    };
    const ctx: CampaignContext = {
      ...baseContext,
      activeEncounter,
    };
    const prompt = formatSystemPrompt(ctx);
    // VICTORY section should NOT appear for ongoing fights
    expect(prompt).not.toContain("⚔️ VICTORY");
  });

  it("does NOT include the Victory section when there is no active encounter", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).not.toContain("⚔️ VICTORY");
  });
});

// ---------------------------------------------------------------------------
// Milestone L Slice 2 — Level-Up Generation Mandate
// ---------------------------------------------------------------------------

describe("formatSystemPrompt — Level-Up Generation Mandate", () => {
  it("includes 'Level-Up Generation Mandate' in Iron Laws", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).toContain("Level-Up Generation Mandate");
  });

  it("mandates calling triggerLevelUp after leveledUp: true", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).toContain("triggerLevelUp");
  });

  it("prohibits narrating HP increases without tool response", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).toContain("NEVER narrate HP increases");
  });

  it("instructs diegetic level-up narration — no 'you leveled up'", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).toContain("Never say 'you leveled up'");
  });
});

// ---------------------------------------------------------------------------
// Milestone L Slice 2 — Hit dice display in Character State
// ---------------------------------------------------------------------------

describe("formatSystemPrompt — hit dice display", () => {
  it("includes Hit Dice line in Character State", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).toContain("Hit Dice:");
  });

  it("shows remaining/total format", () => {
    const prompt = formatSystemPrompt(baseContext);
    // wizard level 5: 3 remaining / 5 total d6
    expect(prompt).toContain("3/5 d6");
  });

  it("shows correct die size for fighter (d10)", () => {
    const fighterCtx: CampaignContext = {
      ...baseContext,
      character: { ...baseCharacter, class: "fighter", hitDiceTotal: 4, hitDiceRemaining: 4 },
    };
    const prompt = formatSystemPrompt(fighterCtx);
    expect(prompt).toContain("4/4 d10");
  });

  it("shows correct die size for barbarian (d12)", () => {
    const barbarianCtx: CampaignContext = {
      ...baseContext,
      character: { ...baseCharacter, class: "barbarian", hitDiceTotal: 3, hitDiceRemaining: 1 },
    };
    const prompt = formatSystemPrompt(barbarianCtx);
    expect(prompt).toContain("1/3 d12");
  });
});

// ---------------------------------------------------------------------------
// Milestone L Slice 2 — Victory section awardXP guidance
// ---------------------------------------------------------------------------

describe("formatSystemPrompt — Victory section awardXP guidance", () => {
  it("includes awardXP instruction in Victory section", () => {
    const ctx: CampaignContext = {
      ...baseContext,
      activeEncounter: resolvedEncounter,
    };
    const prompt = formatSystemPrompt(ctx);
    expect(prompt).toContain("awardXP");
  });

  it("references Challenge Ratings in the XP guidance", () => {
    const ctx: CampaignContext = {
      ...baseContext,
      activeEncounter: resolvedEncounter,
    };
    const prompt = formatSystemPrompt(ctx);
    expect(prompt).toContain("Challenge Ratings");
  });
});
