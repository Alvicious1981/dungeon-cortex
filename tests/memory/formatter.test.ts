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
  class: "Wizard",
  level: 5,
  hp: 28,
  maxHp: 32,
  xp: 6500,
  stats: { STR: 8, DEX: 14, CON: 12, INT: 18, WIS: 14, CHA: 10 },
  spellSlots: null,
  concentrationSpellId: null,
  inventory: [],
};

const baseContext: CampaignContext = {
  character: baseCharacter,
  activeEncounter: null,
  recentLogs: [],
  relevantMemories: [],
  quests: [],
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
