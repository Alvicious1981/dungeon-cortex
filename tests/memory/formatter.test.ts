/**
 * tests/memory/formatter.test.ts
 *
 * Tests for Iron Laws mandates added in Milestone K.
 * Verifies that formatSystemPrompt injects the Loot Generation Mandate
 * and the Victory trigger section when the encounter is resolved.
 */

import { describe, it, expect } from "vitest";
import { formatSystemPrompt, formatNPCContext, type ActiveNPC } from "@/lib/memory/formatter";
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

// ---------------------------------------------------------------------------
// Milestone N Slice 3 — Social Interaction Mandate (task 2.28)
// ---------------------------------------------------------------------------

describe("formatSystemPrompt — Social Interaction Mandate", () => {
  it("includes 'Social Interaction Mandate' in Iron Laws (task 2.28)", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).toContain("Social Interaction Mandate");
  });

  it("mandates calling rollReaction on first NPC meeting", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).toContain("rollReaction");
  });

  it("mandates calling socialCheck before narrating social outcomes", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).toContain("socialCheck");
  });

  it("mandates calling getRumors for local information requests", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).toContain("getRumors");
  });

  it("includes 'The engine decides what the NPC knows and feels'", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).toContain("The engine decides what the NPC knows and feels");
  });

  it("includes NPC context block in prompt when activeNPC is provided", () => {
    const npc: ActiveNPC = {
      name: "Old Bertram",
      disposition: 4,
      personalityTags: {
        motivation: "To repay an old debt before they die.",
        secret: "They once betrayed a trusted friend.",
        distinctiveTrait: "Smells faintly of woodsmoke, even indoors.",
      },
      hasMetPlayer: true,
    };
    const prompt = formatSystemPrompt({ ...baseContext, activeNPC: npc });
    expect(prompt).toContain("Old Bertram");
    expect(prompt).toContain("Friendly");
  });

  it("does NOT include NPC context block when activeNPC is absent", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).not.toContain("🎭 NPC:");
  });
});

// ---------------------------------------------------------------------------
// Milestone N Slice 3 — formatNPCContext (tasks 2.29 & 2.30)
// ---------------------------------------------------------------------------

const metNPC: ActiveNPC = {
  name: "Greta the Ironmonger",
  disposition: 5,
  personalityTags: {
    motivation: "To accumulate enough wealth to buy land and retire.",
    secret: "They owe money to people who will hurt their family if unpaid.",
    distinctiveTrait: "Always touches the left side of their jaw when thinking.",
  },
  hasMetPlayer: true,
};

describe("formatNPCContext — met NPC (task 2.29)", () => {
  it("includes the NPC name", () => {
    expect(formatNPCContext(metNPC)).toContain("Greta the Ironmonger");
  });

  it("renders the 🟢 icon for Friendly disposition (5)", () => {
    expect(formatNPCContext(metNPC)).toContain("🟢");
  });

  it("renders the band label 'Friendly'", () => {
    expect(formatNPCContext(metNPC)).toContain("Friendly");
  });

  it("renders the numeric disposition value", () => {
    expect(formatNPCContext(metNPC)).toContain("(5)");
  });

  it("renders the NPC's motivation", () => {
    expect(formatNPCContext(metNPC)).toContain("accumulate enough wealth");
  });

  it("renders the NPC's distinctive trait", () => {
    expect(formatNPCContext(metNPC)).toContain("left side of their jaw");
  });

  it("does NOT expose the NPC's secret in the output", () => {
    // The secret must be withheld from the prompt — narrator cannot reveal it
    expect(formatNPCContext(metNPC)).not.toContain("owe money to people");
  });

  it("includes the secret-withholding note", () => {
    expect(formatNPCContext(metNPC)).toContain("NPC's secret is known to them but concealed");
  });

  it("renders 🔴 icon for Hostile disposition (-8)", () => {
    const hostile: ActiveNPC = { ...metNPC, disposition: -8 };
    expect(formatNPCContext(hostile)).toContain("🔴");
    expect(formatNPCContext(hostile)).toContain("Hostile");
  });

  it("renders 🟠 icon for Unfriendly disposition (-3)", () => {
    const unfriendly: ActiveNPC = { ...metNPC, disposition: -3 };
    expect(formatNPCContext(unfriendly)).toContain("🟠");
    expect(formatNPCContext(unfriendly)).toContain("Unfriendly");
  });

  it("renders ⚪ icon for Indifferent disposition (0)", () => {
    const indifferent: ActiveNPC = { ...metNPC, disposition: 0 };
    expect(formatNPCContext(indifferent)).toContain("⚪");
    expect(formatNPCContext(indifferent)).toContain("Indifferent");
  });

  it("renders 💛 icon for Helpful disposition (9)", () => {
    const helpful: ActiveNPC = { ...metNPC, disposition: 9 };
    expect(formatNPCContext(helpful)).toContain("💛");
    expect(formatNPCContext(helpful)).toContain("Helpful");
  });
});

describe("formatNPCContext — unmet NPC (task 2.30)", () => {
  const unmetNPC: ActiveNPC = {
    name: "Stranger at the Gate",
    disposition: null,
    personalityTags: null,
    hasMetPlayer: false,
  };

  it("renders the NPC name for unmet NPC", () => {
    expect(formatNPCContext(unmetNPC)).toContain("Stranger at the Gate");
  });

  it("instructs the AI to call rollReaction", () => {
    expect(formatNPCContext(unmetNPC)).toContain("rollReaction");
  });

  it("says 'Not yet met'", () => {
    expect(formatNPCContext(unmetNPC)).toContain("Not yet met");
  });

  it("does NOT render disposition or personality for unmet NPC", () => {
    const output = formatNPCContext(unmetNPC);
    expect(output).not.toContain("Disposition:");
    expect(output).not.toContain("Motivation:");
  });
});
