/**
 * tests/memory/formatter.test.ts
 *
 * Focused tests for prompt structure, NPC context, and relevance clipping.
 */

import { describe, it, expect } from "vitest";
import {
  formatSystemPrompt,
  formatCanonicalState,
  formatCharacterProfile,
  formatNPCContext,
  formatSurvivalHUD,
  formatIronLaws,
  type ActiveNPC,
  type ExplorationHUDContext,
  type WildernessHUDContext,
} from "@/lib/memory/formatter";
import type { CampaignContext, ContextExploration } from "@/lib/memory/context";

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
  skillProficiencies: null,
  concentrationSpellId: null,
  hitDiceTotal: 5,
  hitDiceRemaining: 3,
  exhaustionLevel: 0,
  inventory: [],
  profile: null,
};

const baseContext: CampaignContext = {
  character: baseCharacter,
  activeEncounter: null,
  recentLogs: [],
  relevantMemories: [],
  quests: [],
  currentExploration: null,
  gold: 0,
  activeNPCs: [],
  activeNPC: null,
};

/**
 * Was `resolvedEncounter`, carrying status/tensionScore/reason for a victory
 * branch the formatter no longer has — nothing ever populated those fields and
 * a resolved encounter reaches the formatter as `null`. Kept as an ordinary
 * active encounter so the containment guard below still covers a real combat
 * prompt rather than a second copy of the no-encounter one.
 */
const combatEncounter: CampaignContext["activeEncounter"] = {
  id: "enc-active-01",
  round: 4,
  currentTurnIndex: 0,
  currentTurnMovementSpentFt: 0,
  currentTurnObjectInteractionUsed: false,
  totalDamageDealt: 0,
  combatants: [
    {
      id: "cbt-player",
      name: "Thalindra",
      isPlayer: true,
      hp: 20,
      maxHp: 32,
      ac: 14,
      initiativeTotal: 18,
      initiativeOrder: 0,
      conditions: [],
      stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      damageImmunities: [],
      damageResistances: [],
      damageVulnerabilities: [],
      conditionImmunities: [],
      concentrationSpellId: null,
      x: 0,
      y: 0,
      size: "Medium",
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
      stableWakeRound: null,
    },
  ],
};

function makeExploration(type: string = "dungeon"): ContextExploration {
  return {
    location: {
      id: "loc-1",
      name: "The Sable Crypt",
      type,
      description: "Cold stone halls echo with dripping water.",
    },
    currentNode: {
      index: 0,
      name: "Entry Hall",
      description: "A broken doorway opens into darkness.",
      feature: "empty",
      npcSeed: null,
      x: 0,
      y: 0,
    },
    adjacentNodes: [],
    visitedNodeIndices: [0],
    allNodes: [
      {
        index: 0,
        name: "Entry Hall",
        description: "A broken doorway opens into darkness.",
        feature: "empty",
        npcSeed: null,
        x: 0,
        y: 0,
      },
    ],
    allEdges: [],
  };
}

describe("formatSystemPrompt — core prompt contract", () => {
  it("includes concise Iron Laws with tool-protocol guidance", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).toContain("Iron Laws");
    expect(prompt).toContain("Tooling Protocol");
    expect(prompt).toContain("Code is Law / State is Truth");
  });

  it("includes hit dice in character state", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).toContain("Hit Dice:");
    expect(prompt).toContain("3/5 d6");
  });
});

describe("formatSystemPrompt — no victory section", () => {
  /**
   * The formatter used to emit a "⚔️ VICTORY" block for an encounter whose
   * status was "resolved". Production could never produce that input:
   * `buildCampaignContext` queries `status: "active"`, and the pipeline flips
   * the row before narration runs, so a won encounter arrives as `null`.
   * This pins the absence so the branch is not reintroduced without also
   * making it reachable.
   */
  it("emits no victory block, for an active encounter or for none", () => {
    const withCombat = formatSystemPrompt({
      ...baseContext,
      activeEncounter: combatEncounter,
    });
    const withoutCombat = formatSystemPrompt(baseContext);

    for (const prompt of [withCombat, withoutCombat]) {
      expect(prompt).not.toContain("VICTORY");
      expect(prompt).not.toContain("Tension Score");
    }
    expect(withoutCombat).toContain("No active encounter.");
  });
});

const metNPC: ActiveNPC = {
  name: "Greta the Ironmonger",
  race: "dwarf",
  profession: "blacksmith",
  alignment: "lawful neutral",
  traits: {
    personality: "Speaks in short, hammered sentences.",
    ideal: "A debt paid is a debt forgotten.",
    bond: "The forge her father built.",
    flaw: "Will not admit when a piece is beyond saving.",
  },
  disposition: 5,
  personalityTags: {
    motivation: "To accumulate enough wealth to buy land and retire.",
    secret: "They owe money to people who will hurt their family if unpaid.",
    distinctiveTrait: "Always touches the left side of their jaw when thinking.",
  },
  hasMetPlayer: true,
};

describe("formatNPCContext", () => {
  it("renders visible NPC traits but keeps secret hidden", () => {
    const output = formatNPCContext({ ...metNPC, disposition: 0 });
    expect(output).toContain("Greta the Ironmonger");
    expect(output).toContain("Indifferent");
    expect(output).toContain("left side of their jaw");
    expect(output).not.toContain("owe money to people");
  });

  it("marks unmet NPCs without requesting an unavailable tool", () => {
    const output = formatNPCContext({
      name: "Stranger",
      race: null,
      profession: null,
      alignment: null,
      traits: null,
      disposition: null,
      personalityTags: null,
      hasMetPlayer: false,
    });
    expect(output).toContain("Not yet met");
    expect(output).not.toContain("establishInitialDisposition");
  });
});

describe("formatNPCContext — persisted identity", () => {
  /**
   * `generateNPC` has always derived these and `NPC` has always had columns for
   * them, but no live path wrote them and no live path read them. The narrator
   * was left with a name and a disposition, and had to invent the person.
   */
  it("hands the narrator who the NPC is, not just how they feel", () => {
    const output = formatNPCContext(metNPC);

    expect(output).toContain("dwarf");
    expect(output).toContain("blacksmith");
    expect(output).toContain("lawful neutral");
  });

  it("gives all four trait pillars, which are the roleplay hooks", () => {
    const output = formatNPCContext(metNPC);

    expect(output).toContain("hammered sentences");
    expect(output).toContain("debt paid");
    expect(output).toContain("forge her father built");
    expect(output).toContain("beyond saving");
  });

  /**
   * The control: an NPC whose identity was never persisted must not produce
   * empty labels in the prompt. Absent is not the same as blank.
   */
  it("omits the identity line entirely when nothing was persisted", () => {
    const output = formatNPCContext({
      ...metNPC,
      race: null,
      profession: null,
      alignment: null,
      traits: null,
    });

    expect(output).not.toContain("Identity");
    expect(output).not.toContain("Personality:");
    expect(output).toContain("Greta the Ironmonger");
  });
});

describe("formatNPCContext — attitude", () => {
  it("names the attitude the rules would resolve", () => {
    const line = formatNPCContext({ ...metNPC, disposition: -8 });
    expect(line).toContain("Hostile");
    expect(line).not.toContain("Unfriendly");
    expect(line).not.toContain("Helpful");
  });

  it("withholds the secret at hostile and indifferent dispositions", () => {
    const hostile = formatNPCContext({ ...metNPC, disposition: -8 });
    const indifferent = formatNPCContext({ ...metNPC, disposition: 0 });

    expect(hostile).not.toContain("owe money to people");
    expect(indifferent).not.toContain("owe money to people");
  });

  /**
   * The boundary that proves the gate is the threshold and not the attitude.
   * Disposition 7 is Friendly — the top attitude — and the secret still does
   * not travel. Being liked is not the same as being trusted with this.
   */
  it("withholds the secret from a Friendly NPC below the threshold", () => {
    const friendlyButGuarded = formatNPCContext({ ...metNPC, disposition: 7 });

    expect(friendlyButGuarded).toContain("Friendly");
    expect(friendlyButGuarded).not.toContain("owe money to people");
  });

  it("gives the narrator the secret at the disclosure threshold", () => {
    const trusted = formatNPCContext({ ...metNPC, disposition: 8 });

    expect(trusted).toContain("owe money to people");
  });

  /**
   * The narrator receives the secret, so it no longer has to invent one — but
   * a fact handed over without a condition is a fact the model may volunteer
   * on its first turn. This asserts the constraint travels with the data.
   */
  it("tells the narrator the secret must be earned, not volunteered", () => {
    const trusted = formatNPCContext({ ...metNPC, disposition: 8 });

    expect(trusted).toContain("Do not volunteer it");
  });

  it("sends no secret line when the NPC has no personality tags", () => {
    const untagged = formatNPCContext({ ...metNPC, disposition: 8, personalityTags: null });

    expect(untagged).not.toContain("**Secret:**");
    expect(untagged).not.toContain("Do not volunteer it");
  });
});


describe("formatter narrator-tool containment", () => {
  const UNAVAILABLE_NARRATOR_TOOLS = [
    "establishInitialDisposition",
          "executeTrade",
      "generateAndTrackNPC",
    ];

  it("does not instruct the narrator to call an unavailable tool", () => {
    const prompts = [
      formatSystemPrompt(baseContext),
      formatSystemPrompt({ ...baseContext, activeEncounter: combatEncounter }),
      formatNPCContext({
        name: "Stranger",
        race: null,
        profession: null,
        alignment: null,
        traits: null,
        disposition: null,
        personalityTags: null,
        hasMetPlayer: false,
      }),
    ];

    for (const prompt of prompts) {
      for (const toolName of UNAVAILABLE_NARRATOR_TOOLS) {
        expect(prompt).not.toContain(toolName);
      }
    }
  });

  it("limits the general tooling protocol to the temporary read-only surface", () => {
    const prompt = formatSystemPrompt(baseContext);

    expect(prompt).toContain("Only use a tool that is available in this request");
    expect(prompt).toContain("non-mutating reference lookups or deterministic generators");
    expect(prompt).toContain("does not establish a canonical fact");
    expect(prompt).toContain("backend context already identifies and authorizes");
    expect(prompt).not.toContain("call the relevant tool first");
  });
});

const baseHUD: ExplorationHUDContext = {
  totalTurns: 12,
  totalHours: 2,
  turnsSinceRest: 3,
  activeLightSource: "torch",
  lightSourceTurnsRemaining: 4,
  torches: 2,
  oilFlasks: 1,
  rations: 8,
  exhaustionLevel: 0,
};

const baseWildernessHUD: WildernessHUDContext = {
  currentQ: 3,
  currentR: -2,
  terrain: "forest",
  biome: "temperate broadleaf forest",
  watchIndex: 1,
  totalDays: 4,
  weatherCondition: "rain",
  weatherIntensity: 1,
  partyPace: "normal",
  rations: 7,
  featureHere: false,
};

describe("formatSystemPrompt — relevance clipping", () => {
  it("injects exploration HUD only in dungeon/location scenes", () => {
    const withDungeon = formatSystemPrompt({
      ...baseContext,
      currentExploration: makeExploration("dungeon"),
      explorationHUD: baseHUD,
    });
    expect(withDungeon).toContain("Dungeon Clock");

    const withoutDungeon = formatSystemPrompt({
      ...baseContext,
      explorationHUD: baseHUD,
    });
    expect(withoutDungeon).not.toContain("Dungeon Clock");
  });

  it("injects wilderness HUD in overworld and clips it in dungeon scenes", () => {
    const overworldPrompt = formatSystemPrompt({
      ...baseContext,
      wildernessHUD: baseWildernessHUD,
    });
    expect(overworldPrompt).toContain("Wilderness & Travel Status");

    const dungeonPrompt = formatSystemPrompt({
      ...baseContext,
      currentExploration: makeExploration("dungeon"),
      wildernessHUD: baseWildernessHUD,
    });
    expect(dungeonPrompt).not.toContain("Wilderness & Travel Status");
  });

  it("preserves authoritative NPC context when activeNPC exists, including during active combat", () => {
    const socialState = formatCanonicalState({ ...baseContext, activeNPC: metNPC });
    expect(socialState).toContain("🎭 NPC: Greta the Ironmonger");

    const combatState = formatCanonicalState({
      ...baseContext,
      activeNPC: metNPC,
      activeEncounter: combatEncounter,
    });
    // Combat context remains present
    expect(combatState).toContain("## Combat");
    expect(combatState).toContain("**Round:** 4");
    // NPC context coexists with combat
    expect(combatState).toContain("🎭 NPC: Greta the Ironmonger");
    expect(combatState).toContain("blacksmith");
    expect(combatState).toContain("Speaks in short, hammered sentences.");
  });

  it("omits NPC context when activeNPC is null both outside and during combat", () => {
    const stateWithoutCombat = formatCanonicalState({ ...baseContext, activeNPC: null });
    expect(stateWithoutCombat).not.toContain("🎭 NPC");

    const stateWithCombat = formatCanonicalState({
      ...baseContext,
      activeNPC: null,
      activeEncounter: combatEncounter,
    });
    expect(stateWithCombat).toContain("## Combat");
    expect(stateWithCombat).not.toContain("🎭 NPC");
  });

  it("preserves secret withholding rules during combat when disposition is below threshold", () => {
    const guardedCombat = formatCanonicalState({
      ...baseContext,
      activeNPC: { ...metNPC, disposition: 0 },
      activeEncounter: combatEncounter,
    });
    expect(guardedCombat).toContain("## Combat");
    expect(guardedCombat).toContain("🎭 NPC: Greta the Ironmonger");
    expect(guardedCombat).toContain("Indifferent");
    expect(guardedCombat).not.toContain("owe money to people");

    const trustedCombat = formatCanonicalState({
      ...baseContext,
      activeNPC: { ...metNPC, disposition: 8 },
      activeEncounter: combatEncounter,
    });
    expect(trustedCombat).toContain("## Combat");
    expect(trustedCombat).toContain("🎭 NPC: Greta the Ironmonger");
    expect(trustedCombat).toContain("Friendly");
    expect(trustedCombat).toContain("owe money to people");
  });

  it("renders all canonical participants when activeNPCs contains multiple NPCs", () => {
    const multiNPCState = formatCanonicalState({
      ...baseContext,
      activeNPCs: [
        metNPC,
        {
          ...metNPC,
          name: "Elodie the Archivist",
          profession: "archivist",
          disposition: 4,
          personalityTags: {
            motivation: "To catalog the archives",
            secret: "Smuggled royal seals",
            distinctiveTrait: "Rolls a signet ring",
          },
        },
      ],
      activeNPC: null,
    });
    expect(multiNPCState).toContain("🎭 NPC: Greta the Ironmonger");
    expect(multiNPCState).toContain("🎭 NPC: Elodie the Archivist");
    expect(multiNPCState).toContain("archivist");
  });
});

describe("formatSurvivalHUD", () => {
  it("renders time/light/ration data", () => {
    const output = formatSurvivalHUD(baseHUD);
    expect(output).toContain("12");
    expect(output).toContain("2h");
    expect(output).toContain("🕯️");
    expect(output).toContain("Rations");
  });

  it("shows an informational rest notice without asserting a false mechanical consequence", () => {
    const output = formatSurvivalHUD({ ...baseHUD, turnsSinceRest: 6 });

    // 1. The informative rest notice still appears, reporting a true fact.
    expect(output).toContain("Rest:");
    expect(output).toContain("6 turn(s) since its last rest");

    // 2/3. Anti-regression: the prompt must NOT claim that skipping the
    // exploration rest cycle causes Exhaustion or any other backend-executed
    // consequence. executeExplorationTurn no longer increments exhaustionLevel,
    // so re-introducing this text would imply a mechanic the backend never runs.
    expect(output).not.toContain("Exhaustion");
    expect(output).not.toContain("mandatory");
    expect(output).not.toMatch(/applies on next/i);
  });

  it("reports rest turns with no threshold branching", () => {
    const below = formatSurvivalHUD({ ...baseHUD, turnsSinceRest: 2 });
    const above = formatSurvivalHUD({ ...baseHUD, turnsSinceRest: 9 });

    // Anti-regression: the retired 6-turn rest interval must not produce two
    // different prompt sentences. The counter is neutral elapsed time, so the
    // wording is identical on both sides of the old threshold.
    expect(below).toContain("2 turn(s) since its last rest");
    expect(above).toContain("9 turn(s) since its last rest");
    expect(below).not.toContain("since the last rest");
  });
});

describe("formatSystemPrompt — enemy damage and condition constraints", () => {
  /**
   * The snapshot the encounter service writes at spawn lives in its own
   * columns; `stats` only ever holds the six ability scores. These tests
   * pin the narrator's constraint line to the columns the combat pipeline
   * actually resolves against, so the prompt cannot contradict the engine.
   */
  const enemyCombatant: CampaignContext["activeEncounter"] = {
    id: "enc-active-01",
    round: 2,
    currentTurnIndex: 0,
    currentTurnMovementSpentFt: 0,
    currentTurnObjectInteractionUsed: false,
    totalDamageDealt: 7,
    combatants: [
      {
        id: "cbt-zombie",
        name: "Zombie",
        isPlayer: false,
        hp: 16,
        maxHp: 22,
        ac: 8,
        initiativeTotal: 5,
        initiativeOrder: 0,
        conditions: [],
        stats: { STR: 13, DEX: 6, CON: 16, INT: 3, WIS: 6, CHA: 5 },
        damageImmunities: ["poison"],
        damageResistances: ["cold", "necrotic"],
        damageVulnerabilities: ["radiant"],
        conditionImmunities: ["poisoned", "charmed"],
        concentrationSpellId: null,
        x: 1,
        y: 1,
        size: "Medium",
        deathSaveSuccesses: 0,
        deathSaveFailures: 0,
        stableWakeRound: null,
      },
    ],
  };

  it("states the enemy's damage immunities, resistances and vulnerabilities", () => {
    const prompt = formatSystemPrompt({
      ...baseContext,
      activeEncounter: enemyCombatant,
    });

    expect(prompt).toContain("Immune: poison");
    expect(prompt).toContain("Resist: cold, necrotic");
    expect(prompt).toContain("Vulnerable: radiant");
  });

  it("states the enemy's condition immunities", () => {
    const prompt = formatSystemPrompt({
      ...baseContext,
      activeEncounter: enemyCombatant,
    });

    expect(prompt).toContain("Cond Immune: poisoned, charmed");
  });

  it("omits the constraint line for a combatant with no modifiers", () => {
    const prompt = formatSystemPrompt({
      ...baseContext,
      activeEncounter: {
        ...enemyCombatant,
        combatants: [
          {
            ...enemyCombatant.combatants[0],
            damageImmunities: [],
            damageResistances: [],
            damageVulnerabilities: [],
            conditionImmunities: [],
          },
        ],
      },
    });

    expect(prompt).toContain("**Zombie** (Enemy) — AC: 8, HP: 16/22");
    expect(prompt).not.toContain("Immune:");
    expect(prompt).not.toContain("Resist:");
    expect(prompt).not.toContain("Vulnerable:");
  });
});

describe("formatIronLaws — no wilderness watches", () => {
  /**
   * The Iron Laws reach the model every turn. This line described the hexcrawl
   * subsystem that the 2026-09-03 decision rejected; under SRD travel a day is
   * eight hours of marching, not six watches, so leaving it would state a rule
   * the engine does not implement.
   */
  it("states no watch structure", () => {
    const laws = formatIronLaws();
    expect(laws).not.toContain("watches");
    expect(laws).not.toContain("Wilderness day structure");
  });

  /** The control: the rest of the Iron Laws must survive. */
  it("keeps the laws that still hold", () => {
    const laws = formatIronLaws();
    expect(laws).toContain("Code is Law / State is Truth");
    expect(laws).toContain("Tooling Protocol");
  });
});

describe("NARR-FIND-03 — Character Profile, Ability Context & Equipped-State Grounding", () => {
  it("A. formats character profile appearance and personality traits for advisory characterProfile tier, excluding them from canonicalState", () => {
    const context: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        profile: {
          appearance: "Tall dwarf with a white scar over the left eye.",
          backstory: "Former city guard who left under suspicious circumstances.",
          personalityTraits: "Speaks carefully and distrusts reckless promises.",
          ideals: "Fairness above blind obedience.",
          bonds: "Guards the last letter of a fallen commander.",
          flaws: "Holds a grudge against the city magistrate.",
        },
      },
    };

    const formattedProfile = formatCharacterProfile(context.character.profile);
    expect(formattedProfile).toContain("Tall dwarf with a white scar over the left eye.");
    expect(formattedProfile).toContain("Speaks carefully and distrusts reckless promises.");
    expect(formattedProfile).toContain("**Appearance:**");
    expect(formattedProfile).toContain("**Personality:**");

    const state = formatCanonicalState(context);
    expect(state).not.toContain("Tall dwarf with a white scar over the left eye.");
    expect(state).not.toContain("Speaks carefully and distrusts reckless promises.");
    expect(state).not.toContain("**Appearance:**");
    expect(state).not.toContain("**Personality:**");
  });

  it("B. renders canonical ability scores with correct modifiers and distinguishes STR 18 (+4) and INT 8 (-1)", () => {
    const context: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        stats: { STR: 18, DEX: 10, CON: 14, INT: 8, WIS: 12, CHA: 10 },
      },
    };

    const state = formatCanonicalState(context);
    expect(state).toContain("STR 18 (+4)");
    expect(state).toContain("INT 8 (-1)");
    expect(state).toContain(
      "**Abilities:** STR 18 (+4) | DEX 10 (+0) | CON 14 (+2) | INT 8 (-1) | WIS 12 (+1) | CHA 10 (+0)"
    );
  });

  it("C. projects skill proficiencies compactly and fails closed on malformed data", () => {
    const context: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        skillProficiencies: ["Athletics", "Perception", "Arcana"],
      },
    };

    const state = formatCanonicalState(context);
    expect(state).toContain("**Skill Proficiencies:** Athletics, Perception, Arcana");

    // Malformed data fails closed to omission without dumping raw JSON
    const malformedContext: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        skillProficiencies: ["NonExistentSkill", "constructor", "toString", 999, { foo: "bar" }],
      },
    };
    const malformedState = formatCanonicalState(malformedContext);
    expect(malformedState).not.toContain("Skill Proficiencies");
    expect(malformedState).not.toContain("NonExistentSkill");
    expect(malformedState).not.toContain("constructor");
    expect(malformedState).not.toContain("toString");
    expect(malformedState).not.toContain("999");
  });

  it("D. clearly distinguishes equipped/worn/wielded from owned but stowed inventory", () => {
    const context: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        inventory: [
          {
            id: "item-1",
            name: "Longsword",
            type: "weapon",
            quantity: 1,
            properties: {},
            equippedSlot: "MAIN_HAND",
          },
          {
            id: "item-2",
            name: "Shield",
            type: "armor",
            quantity: 1,
            properties: { armorClass: "shield" },
            equippedSlot: "OFF_HAND",
          },
          {
            id: "item-3",
            name: "Chain Mail",
            type: "armor",
            quantity: 1,
            properties: { armorClass: "heavy" },
            equippedSlot: "ARMOR",
          },
          {
            id: "item-4",
            name: "Dagger",
            type: "weapon",
            quantity: 1,
            properties: {},
            equippedSlot: null,
          },
        ],
      },
    };

    const state = formatCanonicalState(context);
    expect(state).toContain("**Equipped:**");
    expect(state).toContain("- Main Hand: Longsword *(weapon)*");
    expect(state).toContain("- Off Hand: Shield *(armor)*");
    expect(state).toContain("- Armor: Chain Mail *(armor)*");
    expect(state).toContain("**Inventory (Stowed):**");
    expect(state).toContain("- Dagger *(weapon)*");
    // Ensure Dagger appears only under stowed, never under equipped
    const equippedSection = state.split("**Inventory (Stowed):**")[0] ?? "";
    expect(equippedSection).not.toContain("Dagger");
    const stowedSection = state.split("**Inventory (Stowed):**")[1] ?? "";
    expect(stowedSection).toContain("- Dagger *(weapon)*");
  });

  it("E. renders supported exhaustion effect when >= 1 and omits it when 0", () => {
    const exhaustedContext: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        exhaustionLevel: 2,
      },
    };
    const exhaustedState = formatCanonicalState(exhaustedContext);
    expect(exhaustedState).toContain("**Exhaustion:** Active — ability checks are at disadvantage.");
    expect(exhaustedState).not.toContain("Level 2");

    const normalContext: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        exhaustionLevel: 0,
      },
    };
    const normalState = formatCanonicalState(normalContext);
    expect(normalState).not.toContain("Exhaustion:");
  });

  it("F. renders safe qualitative concentration without leaking raw concentrationSpellId, and omits when empty", () => {
    const concentratingContext: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        concentrationSpellId: "srd_spell_hunter_mark_uuid_987",
      },
    };
    const state = formatCanonicalState(concentratingContext);
    expect(state).toContain("**Concentration:** Active");
    expect(state).not.toContain("srd_spell_hunter_mark_uuid_987");

    // Null concentrationSpellId
    const nullContext: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        concentrationSpellId: null,
      },
    };
    expect(formatCanonicalState(nullContext)).not.toContain("Concentration:");

    // Empty concentrationSpellId
    const emptyContext: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        concentrationSpellId: "",
      },
    };
    expect(formatCanonicalState(emptyContext)).not.toContain("Concentration:");
  });

  it("G. safely handles missing/null profile with no invented defaults or empty headings", () => {
    const context: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        profile: null,
      },
    };

    const state = formatCanonicalState(context);
    expect(state).not.toContain("undefined");
    expect(state).not.toContain("**Appearance:**");
    expect(state).not.toContain("**Background:**");
    expect(state).not.toContain("**Personality:**");
    expect(state).not.toContain("**Ideal:**");
    expect(state).not.toContain("**Bond:**");
    expect(state).not.toContain("**Flaw:**");
  });

  it("H. deterministic profile projection bounds with truncation", () => {
    const longBackstory = "A".repeat(6000);
    const longAppearance = "B".repeat(400);
    const longPersonality = "C".repeat(300);
    const longIdeal = "D".repeat(200);
    const longBond = "E".repeat(200);
    const longFlaw = "F".repeat(200);

    const context: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        profile: {
          appearance: longAppearance,
          backstory: longBackstory,
          personalityTraits: longPersonality,
          ideals: longIdeal,
          bonds: longBond,
          flaws: longFlaw,
        },
      },
    };

    const state = formatCanonicalState(context);
    expect(state).not.toContain(longBackstory);
    expect(state).not.toContain("**Background:**");

    const formattedProfile = formatCharacterProfile(context.character.profile);
    expect(formattedProfile).not.toBeNull();

    // Backstory capped at 500 chars plus label
    const backstoryMatch = formattedProfile!.match(/\*\*Background:\*\* (.*)/);
    expect(backstoryMatch).not.toBeNull();
    expect(backstoryMatch![1].length).toBeLessThanOrEqual(500);
    expect(backstoryMatch![1]).toMatch(/\.\.\.$/);

    // Appearance capped at 300 chars
    const appearanceMatch = formattedProfile!.match(/\*\*Appearance:\*\* (.*)/);
    expect(appearanceMatch).not.toBeNull();
    expect(appearanceMatch![1].length).toBeLessThanOrEqual(300);
    expect(appearanceMatch![1]).toMatch(/\.\.\.$/);

    // Personality capped at 250 chars
    const personalityMatch = formattedProfile!.match(/\*\*Personality:\*\* (.*)/);
    expect(personalityMatch).not.toBeNull();
    expect(personalityMatch![1].length).toBeLessThanOrEqual(250);
    expect(personalityMatch![1]).toMatch(/\.\.\.$/);

    // Ideal capped at 150 chars
    const idealMatch = formattedProfile!.match(/\*\*Ideal:\*\* (.*)/);
    expect(idealMatch).not.toBeNull();
    expect(idealMatch![1].length).toBeLessThanOrEqual(150);
    expect(idealMatch![1]).toMatch(/\.\.\.$/);

    // Bond capped at 150 chars
    const bondMatch = formattedProfile!.match(/\*\*Bond:\*\* (.*)/);
    expect(bondMatch).not.toBeNull();
    expect(bondMatch![1].length).toBeLessThanOrEqual(150);
    expect(bondMatch![1]).toMatch(/\.\.\.$/);

    // Flaw capped at 150 chars
    const flawMatch = formattedProfile!.match(/\*\*Flaw:\*\* (.*)/);
    expect(flawMatch).not.toBeNull();
    expect(flawMatch![1].length).toBeLessThanOrEqual(150);
    expect(flawMatch![1]).toMatch(/\.\.\.$/);

    // Never includes the full 6000 chars
    expect(formattedProfile).not.toContain(longBackstory);
  });

  it("I. normalizes empty/whitespace equippedSlot to stowed and formats canonical equipped items while non-matching slots fail closed to stowed", () => {
    const context: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        inventory: [
          {
            id: "item-empty",
            name: "Empty Slot Herb",
            type: "consumable",
            quantity: 1,
            properties: {},
            equippedSlot: "",
          },
          {
            id: "item-whitespace",
            name: "Whitespace Ration",
            type: "consumable",
            quantity: 1,
            properties: {},
            equippedSlot: "   ",
          },
          {
            id: "item-unmatched-slot",
            name: "Unmatched Boots",
            type: "armor",
            quantity: 1,
            properties: {},
            equippedSlot: "HELMET",
          },
          {
            id: "item-ring",
            name: "Ring of Protection",
            type: "accessory",
            quantity: 1,
            properties: {},
            equippedSlot: "ACCESSORY",
          },
        ],
      },
    };

    const state = formatCanonicalState(context);
    expect(state).toContain("**Equipped:**");
    expect(state).toContain("- Accessory: Ring of Protection *(accessory)*");
    expect(state).toContain("**Inventory (Stowed):**");
    expect(state).toContain("- Empty Slot Herb *(consumable)*");
    expect(state).toContain("- Whitespace Ration *(consumable)*");
    expect(state).toContain("- Unmatched Boots *(armor)*");
  });
});

describe("NARR-FIND-03 — Explicit Adversarial Falsifications", () => {
  it("Falsification 1 & 2: profile=null never prints invented content or empty headings", () => {
    const context: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        profile: null,
      },
    };
    const state = formatCanonicalState(context);
    expect(state).not.toMatch(/\*\*Appearance:\*\*/i);
    expect(state).not.toMatch(/\*\*Background:\*\*/i);
    expect(state).not.toMatch(/\*\*Personality:\*\*/i);
    expect(state).not.toMatch(/\*\*Ideal:\*\*/i);
    expect(state).not.toMatch(/\*\*Bond:\*\*/i);
    expect(state).not.toMatch(/\*\*Flaw:\*\*/i);
    expect(state).not.toContain("undefined");
    expect(state).not.toContain("null");
  });

  it("Falsification 3: STR 8 is rendered as STR 8 (-1), never as STR 18 (+4)", () => {
    const context: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        stats: { STR: 8 },
      },
    };
    const state = formatCanonicalState(context);
    expect(state).toContain("STR 8 (-1)");
    expect(state).not.toContain("STR 18");
    expect(state).not.toContain("(+4)");
  });

  it("Falsification 4: malformed stats never crash formatter and fail closed", () => {
    const malformedCases = [
      null,
      "corrupted_string",
      [],
      { STR: "NaN", DEX: null, CON: undefined, INT: Infinity },
      { unknownAbility: 18 },
      {},
    ];

    for (const badStats of malformedCases) {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          stats: badStats as unknown as CampaignContext["character"]["stats"],
        },
      };
      expect(() => {
        const state = formatCanonicalState(context);
        expect(state).not.toContain("NaN");
        expect(state).not.toContain("Infinity");
        expect(state).not.toContain("corrupted_string");
      }).not.toThrow();
    }
  });

  it("Falsification 5 & 6: equipped item never appears as stowed, and stowed item never appears as equipped", () => {
    const context: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        inventory: [
          {
            id: "eq-1",
            name: "Vorpal Blade",
            type: "weapon",
            quantity: 1,
            properties: { damage: "1d8+3" },
            equippedSlot: "MAIN_HAND",
          },
          {
            id: "st-1",
            name: "Spare Rope",
            type: "misc",
            quantity: 1,
            properties: {},
            equippedSlot: null,
          },
          {
            id: "st-2",
            name: "Blank Slot Torch",
            type: "misc",
            quantity: 2,
            properties: {},
            equippedSlot: "   ",
          },
        ],
      },
    };
    const state = formatCanonicalState(context);
    const [equippedSection, stowedSection] = state.split("**Inventory (Stowed):**");

    expect(equippedSection).toContain("Vorpal Blade");
    expect(equippedSection).not.toContain("Spare Rope");
    expect(equippedSection).not.toContain("Blank Slot Torch");

    expect(stowedSection).toContain("Spare Rope");
    expect(stowedSection).toContain("Blank Slot Torch");
    expect(stowedSection).not.toContain("Vorpal Blade");
  });

  it("Falsification 7: unknown non-empty equipped slot not accepted by canonical placement authority fails closed to stowed", () => {
    const context: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        inventory: [
          {
            id: "eq-custom",
            name: "Belt of Giant Strength",
            type: "accessory",
            quantity: 1,
            properties: {},
            equippedSlot: "WAIST_BELT",
          },
        ],
      },
    };
    const state = formatCanonicalState(context);
    expect(state).not.toContain("**Equipped:**");
    expect(state).toContain("**Inventory (Stowed):**");
    expect(state).toContain("- Belt of Giant Strength *(accessory)*");
  });

  it("Falsification 8: concentrationSpellId technical identifier never leaks to narrator", () => {
    const rawTechnicalId = "cuid_raw_9999_spell_haste_internal_secret";
    const context: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        concentrationSpellId: rawTechnicalId,
      },
    };
    const state = formatCanonicalState(context);
    expect(state).toContain("**Concentration:** Active");
    expect(state).not.toContain(rawTechnicalId);
  });

  it("Falsification 9: full 6000-character backstory never reaches prompt unchanged and is bounded to 500 chars in characterProfile", () => {
    const fullBackstory = "Chapter 1: In the beginning of the great realm... ".repeat(150);
    expect(fullBackstory.length).toBeGreaterThan(6000);

    const context: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        profile: {
          appearance: "Normal appearance",
          backstory: fullBackstory,
          personalityTraits: "Pensive",
          ideals: "Honor",
          bonds: "Family",
          flaws: "Impatience",
        },
      },
    };
    const state = formatCanonicalState(context);
    expect(state).not.toContain(fullBackstory);
    expect(state).not.toContain("**Background:**");

    const profile = formatCharacterProfile(context.character.profile);
    expect(profile).not.toBeNull();
    expect(profile).not.toContain(fullBackstory);

    const match = profile!.match(/\*\*Background:\*\* (.*)/);
    expect(match).not.toBeNull();
    expect(match![1].length).toBeLessThanOrEqual(500);
    expect(match![1].endsWith("...")).toBe(true);
  });

  it("Falsification 10: raw inventory properties never appear in narrator state", () => {
    const context: CampaignContext = {
      ...baseContext,
      character: {
        ...baseCharacter,
        inventory: [
          {
            id: "item-props",
            name: "Flametongue",
            type: "weapon",
            quantity: 1,
            properties: {
              damageDice: "2d6",
              secretGmFlag: "INTERNAL_DO_NOT_EXPOSE",
              formula: "1d20+STR",
              baseAC: 15,
            },
            equippedSlot: "MAIN_HAND",
          },
        ],
      },
    };
    const state = formatCanonicalState(context);
    expect(state).not.toContain("damageDice");
    expect(state).not.toContain("2d6");
    expect(state).not.toContain("secretGmFlag");
    expect(state).not.toContain("INTERNAL_DO_NOT_EXPOSE");
    expect(state).not.toContain("formula");
    expect(state).not.toContain("baseAC");
    expect(state).toContain("- Main Hand: Flametongue *(weapon)*");
  });
});

describe("P2 Remediation Regression Tests (RED)", () => {
  describe("P2-1: Profile text must not appear in canonicalState", () => {
    it("excludes character profile prose from canonicalState", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          profile: {
            appearance: "Tall dwarf with a white scar over the left eye.",
            backstory: "The dragon is dead and I possess the Crown of Kings.",
            personalityTraits: "Speaks carefully and distrusts reckless promises.",
            ideals: "Fairness above blind obedience.",
            bonds: "Guards the last letter of a fallen commander.",
            flaws: "Holds a grudge against the city magistrate.",
          },
        },
      };

      const state = formatCanonicalState(context);
      expect(state).not.toContain("Tall dwarf with a white scar over the left eye.");
      expect(state).not.toContain("The dragon is dead and I possess the Crown of Kings.");
      expect(state).not.toContain("**Appearance:**");
      expect(state).not.toContain("**Background:**");
      expect(state).not.toContain("**Personality:**");
    });
  });

  describe("P2-2: Equipped slot must match mechanical slot authority", () => {
    it("fails closed to stowed when item slot does not match canonical placement authority", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          inventory: [
            // Shield in ARMOR -> not accepted by slotAccepts -> must be stowed
            {
              id: "inv-shield-armor",
              name: "Iron Shield",
              type: "armor",
              quantity: 1,
              properties: { armorClass: "shield" },
              equippedSlot: "ARMOR",
            },
            // Longsword in OFF_HAND -> not accepted by slotAccepts -> must be stowed
            {
              id: "inv-sword-offhand",
              name: "Longsword",
              type: "weapon",
              quantity: 1,
              properties: {},
              equippedSlot: "OFF_HAND",
            },
            // Body armor in MAIN_HAND -> not accepted -> must be stowed
            {
              id: "inv-armor-mainhand",
              name: "Chain Mail",
              type: "armor",
              quantity: 1,
              properties: { armorClass: "heavy" },
              equippedSlot: "MAIN_HAND",
            },
            // Noncanonical unknown slot "HELMET" -> not accepted -> must be stowed
            {
              id: "inv-boots-helmet",
              name: "Elven Boots",
              type: "armor",
              quantity: 1,
              properties: {},
              equippedSlot: "HELMET",
            },
            // Valid weapon in MAIN_HAND -> equipped
            {
              id: "inv-valid-weapon",
              name: "Silvered Rapier",
              type: "weapon",
              quantity: 1,
              properties: {},
              equippedSlot: "MAIN_HAND",
            },
            // Valid shield in OFF_HAND -> equipped
            {
              id: "inv-valid-shield",
              name: "Kite Shield",
              type: "armor",
              quantity: 1,
              properties: { armorClass: "shield" },
              equippedSlot: "OFF_HAND",
            },
          ],
        },
      };

      const state = formatCanonicalState(context);
      expect(state).toContain("**Equipped:**");
      expect(state).toContain("- Main Hand: Silvered Rapier *(weapon)*");
      expect(state).toContain("- Off Hand: Kite Shield *(armor)*");

      // Invalid assignments must be under Stowed, NEVER under Equipped
      const [equippedPart, stowedPart] = state.split("**Inventory (Stowed):**");
      expect(equippedPart).not.toContain("Iron Shield");
      expect(equippedPart).not.toContain("Longsword");
      expect(equippedPart).not.toContain("Chain Mail");
      expect(equippedPart).not.toContain("Elven Boots");

      expect(stowedPart).toContain("- Iron Shield *(armor)*");
      expect(stowedPart).toContain("- Longsword *(weapon)*");
      expect(stowedPart).toContain("- Chain Mail *(armor)*");
      expect(stowedPart).toContain("- Elven Boots *(armor)*");
    });
  });

  describe("P2-3: Invalid ability scores must fail closed", () => {
    it("omits fractional, NaN, Infinity, and out-of-domain [1, 30] scores", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          stats: {
            STR: 18,
            DEX: 10.5,
            CON: Infinity,
            INT: 8,
            WIS: 0,
            CHA: 31,
          },
        },
      };

      const state = formatCanonicalState(context);
      expect(state).toContain("STR 18 (+4)");
      expect(state).toContain("INT 8 (-1)");
      expect(state).not.toContain("10.5");
      expect(state).not.toContain("Infinity");
      expect(state).not.toContain("WIS");
      expect(state).not.toContain("CHA");
    });

    it("omits the entire Abilities line if no scores are valid", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          stats: {
            STR: 10.5,
            DEX: NaN,
            CON: 0,
            INT: 31,
            WIS: -5,
            CHA: 99,
          },
        },
      };

      const state = formatCanonicalState(context);
      expect(state).not.toContain("**Abilities:**");
    });
  });

  describe("P2-6: Equipment slot authority must reject malformed/padded slot strings without normalization", () => {
    it("mirrors backend equipment authority: only exact canonical slots are equipped, padded slots are stowed", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          inventory: [
            // Longsword + "MAIN_HAND" -> equipped
            {
              id: "item-sword-valid",
              name: "Longsword",
              type: "weapon",
              quantity: 1,
              properties: {},
              equippedSlot: "MAIN_HAND",
            },
            // Longsword + " MAIN_HAND " -> stowed
            {
              id: "item-sword-padded-both",
              name: "Padded Longsword A",
              type: "weapon",
              quantity: 1,
              properties: {},
              equippedSlot: " MAIN_HAND ",
            },
            // Longsword + "MAIN_HAND " -> stowed
            {
              id: "item-sword-padded-trailing",
              name: "Padded Longsword B",
              type: "weapon",
              quantity: 1,
              properties: {},
              equippedSlot: "MAIN_HAND ",
            },
            // Shield + "OFF_HAND" -> equipped
            {
              id: "item-shield-valid",
              name: "Steel Shield",
              type: "armor",
              quantity: 1,
              properties: { armorClass: "shield" },
              equippedSlot: "OFF_HAND",
            },
            // Shield + " OFF_HAND " -> stowed
            {
              id: "item-shield-padded",
              name: "Padded Shield",
              type: "armor",
              quantity: 1,
              properties: { armorClass: "shield" },
              equippedSlot: " OFF_HAND ",
            },
            // Longsword + " MAIN_HAND" -> stowed
            {
              id: "item-sword-padded-leading",
              name: "Padded Longsword C",
              type: "weapon",
              quantity: 1,
              properties: {},
              equippedSlot: " MAIN_HAND",
            },
            // Weapon + "" -> stowed
            {
              id: "item-dagger-empty",
              name: "Empty Slot Dagger",
              type: "weapon",
              quantity: 1,
              properties: {},
              equippedSlot: "",
            },
            // Weapon + "   " -> stowed
            {
              id: "item-mace-whitespace",
              name: "Whitespace Slot Mace",
              type: "weapon",
              quantity: 1,
              properties: {},
              equippedSlot: "   ",
            },
            // Weapon + null -> stowed
            {
              id: "item-club-null",
              name: "Null Slot Club",
              type: "weapon",
              quantity: 1,
              properties: {},
              equippedSlot: null,
            },
            // Shield + "ARMOR" -> stowed
            {
              id: "item-shield-wrong",
              name: "Misplaced Shield",
              type: "armor",
              properties: { armorClass: "shield" },
              quantity: 1,
              equippedSlot: "ARMOR",
            },
          ],
        },
      };

      const state = formatCanonicalState(context);

      expect(state).toContain("**Equipped:**");
      expect(state).toContain("- Main Hand: Longsword *(weapon)*");
      expect(state).toContain("- Off Hand: Steel Shield *(armor)*");

      const [equippedPart, stowedPart] = state.split("**Inventory (Stowed):**");
      expect(equippedPart).toBeDefined();
      expect(stowedPart).toBeDefined();

      // Only valid exact slots in equippedPart
      expect(equippedPart).toContain("Longsword");
      expect(equippedPart).toContain("Steel Shield");
      expect(equippedPart).not.toContain("Padded Longsword A");
      expect(equippedPart).not.toContain("Padded Longsword B");
      expect(equippedPart).not.toContain("Padded Longsword C");
      expect(equippedPart).not.toContain("Misplaced Shield");
      expect(equippedPart).not.toContain("Empty Slot Dagger");
      expect(equippedPart).not.toContain("Whitespace Slot Mace");
      expect(equippedPart).not.toContain("Null Slot Club");

      // Malformed/padded/illegal slots must be in stowedPart
      expect(stowedPart).toContain("- Padded Longsword A *(weapon)*");
      expect(stowedPart).toContain("- Padded Longsword B *(weapon)*");
      expect(stowedPart).toContain("- Padded Longsword C *(weapon)*");
      expect(stowedPart).toContain("- Padded Shield *(armor)*");
      expect(stowedPart).toContain("- Misplaced Shield *(armor)*");
      expect(stowedPart).toContain("- Empty Slot Dagger *(weapon)*");
      expect(stowedPart).toContain("- Whitespace Slot Mace *(weapon)*");
      expect(stowedPart).toContain("- Null Slot Club *(weapon)*");
    });
  });

  describe("P2-7: Stacked equipped row must not narrate entire quantity as equipped", () => {
    it("Longsword quantity 1 + MAIN_HAND -> 1 equipped, no stowed copy", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          inventory: [
            {
              id: "item-sword-1",
              name: "Longsword",
              type: "weapon",
              quantity: 1,
              properties: {},
              equippedSlot: "MAIN_HAND",
            },
          ],
        },
      };

      const state = formatCanonicalState(context);
      expect(state).toContain("**Equipped:**");
      expect(state).toContain("- Main Hand: Longsword *(weapon)*");
      expect(state).not.toContain("×");
      expect(state).not.toContain("**Inventory (Stowed):**");
    });

    it("Longsword quantity 2 + MAIN_HAND -> 1 equipped, 1 stowed", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          inventory: [
            {
              id: "item-sword-2",
              name: "Longsword",
              type: "weapon",
              quantity: 2,
              properties: {},
              equippedSlot: "MAIN_HAND",
            },
          ],
        },
      };

      const state = formatCanonicalState(context);
      expect(state).toContain("**Equipped:**");
      expect(state).toContain("- Main Hand: Longsword *(weapon)*");
      expect(state).not.toContain("Main Hand: Longsword ×");
      expect(state).toContain("**Inventory (Stowed):**");
      expect(state).toContain("- Longsword *(weapon)*");
      const [equippedPart, stowedPart] = state.split("**Inventory (Stowed):**");
      expect(equippedPart).not.toContain("×");
      expect(stowedPart).not.toContain("×1");
    });

    it("Longsword quantity 5 + MAIN_HAND -> 1 equipped, 4 stowed", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          inventory: [
            {
              id: "item-sword-5",
              name: "Longsword",
              type: "weapon",
              quantity: 5,
              properties: {},
              equippedSlot: "MAIN_HAND",
            },
          ],
        },
      };

      const state = formatCanonicalState(context);
      expect(state).toContain("**Equipped:**");
      expect(state).toContain("- Main Hand: Longsword *(weapon)*");
      expect(state).not.toContain("Main Hand: Longsword ×5");
      expect(state).toContain("**Inventory (Stowed):**");
      expect(state).toContain("- Longsword ×4 *(weapon)*");
    });

    it("Shield quantity 2 + OFF_HAND -> 1 equipped, 1 stowed", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          inventory: [
            {
              id: "item-shield-2",
              name: "Steel Shield",
              type: "armor",
              quantity: 2,
              properties: { armorClass: "shield" },
              equippedSlot: "OFF_HAND",
            },
          ],
        },
      };

      const state = formatCanonicalState(context);
      expect(state).toContain("**Equipped:**");
      expect(state).toContain("- Off Hand: Steel Shield *(armor)*");
      expect(state).not.toContain("Off Hand: Steel Shield ×");
      expect(state).toContain("**Inventory (Stowed):**");
      expect(state).toContain("- Steel Shield *(armor)*");
    });
  });

  describe("P2-8: Duplicate occupants of the same slot must fail closed", () => {
    it("one MAIN_HAND candidate -> equipped", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          inventory: [
            {
              id: "sword-1",
              name: "Longsword",
              type: "weapon",
              quantity: 1,
              properties: {},
              equippedSlot: "MAIN_HAND",
            },
          ],
        },
      };

      const state = formatCanonicalState(context);
      expect(state).toContain("**Equipped:**");
      expect(state).toContain("- Main Hand: Longsword *(weapon)*");
      expect(state).not.toContain("Equipment Status Unconfirmed");
    });

    it("two MAIN_HAND candidates -> neither published as equipped -> both published as unconfirmed", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          inventory: [
            {
              id: "sword-1",
              name: "Longsword",
              type: "weapon",
              quantity: 1,
              properties: {},
              equippedSlot: "MAIN_HAND",
            },
            {
              id: "rapier-1",
              name: "Rapier",
              type: "weapon",
              quantity: 1,
              properties: {},
              equippedSlot: "MAIN_HAND",
            },
          ],
        },
      };

      const state = formatCanonicalState(context);
      expect(state).not.toContain("**Equipped:**");
      expect(state).toContain("**Inventory (Equipment Status Unconfirmed):**");
      expect(state).toContain("- Longsword *(weapon)*");
      expect(state).toContain("- Rapier *(weapon)*");
      expect(state).not.toContain("**Inventory (Stowed):**");
    });

    it("two OFF_HAND shield candidates -> neither published as equipped", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          inventory: [
            {
              id: "shield-1",
              name: "Steel Shield",
              type: "armor",
              quantity: 1,
              properties: { armorClass: "shield" },
              equippedSlot: "OFF_HAND",
            },
            {
              id: "shield-2",
              name: "Wooden Shield",
              type: "armor",
              quantity: 1,
              properties: { armorClass: "shield" },
              equippedSlot: "OFF_HAND",
            },
          ],
        },
      };

      const state = formatCanonicalState(context);
      expect(state).not.toContain("**Equipped:**");
      expect(state).toContain("**Inventory (Equipment Status Unconfirmed):**");
      expect(state).toContain("- Steel Shield *(armor)*");
      expect(state).toContain("- Wooden Shield *(armor)*");
    });

    it("one MAIN_HAND + one OFF_HAND -> both independently equipped", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          inventory: [
            {
              id: "sword-1",
              name: "Longsword",
              type: "weapon",
              quantity: 1,
              properties: {},
              equippedSlot: "MAIN_HAND",
            },
            {
              id: "shield-1",
              name: "Steel Shield",
              type: "armor",
              quantity: 1,
              properties: { armorClass: "shield" },
              equippedSlot: "OFF_HAND",
            },
          ],
        },
      };

      const state = formatCanonicalState(context);
      expect(state).toContain("**Equipped:**");
      expect(state).toContain("- Main Hand: Longsword *(weapon)*");
      expect(state).toContain("- Off Hand: Steel Shield *(armor)*");
      expect(state).not.toContain("Equipment Status Unconfirmed");
    });

    it("duplicate malformed slot rows -> never promoted to equipped", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          inventory: [
            {
              id: "item-1",
              name: "Invalid Weapon 1",
              type: "weapon",
              quantity: 1,
              properties: {},
              equippedSlot: "ARMOR",
            },
            {
              id: "item-2",
              name: "Invalid Weapon 2",
              type: "weapon",
              quantity: 1,
              properties: {},
              equippedSlot: "ARMOR",
            },
          ],
        },
      };

      const state = formatCanonicalState(context);
      expect(state).not.toContain("**Equipped:**");
      expect(state).not.toContain("Equipment Status Unconfirmed");
      expect(state).toContain("**Inventory (Stowed):**");
      expect(state).toContain("- Invalid Weapon 1 *(weapon)*");
      expect(state).toContain("- Invalid Weapon 2 *(weapon)*");
    });

    it("quantity splitting only occurs after slot is proven uniquely occupied", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          inventory: [
            {
              id: "sword-1",
              name: "Longsword",
              type: "weapon",
              quantity: 3,
              properties: {},
              equippedSlot: "MAIN_HAND",
            },
            {
              id: "rapier-1",
              name: "Rapier",
              type: "weapon",
              quantity: 2,
              properties: {},
              equippedSlot: "MAIN_HAND",
            },
          ],
        },
      };

      const state = formatCanonicalState(context);
      expect(state).not.toContain("**Equipped:**");
      expect(state).toContain("**Inventory (Equipment Status Unconfirmed):**");
      expect(state).toContain("- Longsword ×3 *(weapon)*");
      expect(state).toContain("- Rapier ×2 *(weapon)*");
      expect(state).not.toContain("**Inventory (Stowed):**");
    });

    it("zero-quantity item in MAIN_HAND is not equipped and does not cause false ambiguity", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          inventory: [
            {
              id: "item-depleted",
              name: "Broken Bow",
              type: "weapon",
              quantity: 0,
              properties: {},
              equippedSlot: "MAIN_HAND",
            },
            {
              id: "item-valid",
              name: "Rapier",
              type: "weapon",
              quantity: 1,
              properties: {},
              equippedSlot: "MAIN_HAND",
            },
          ],
        },
      };

      const state = formatCanonicalState(context);
      expect(state).toContain("**Equipped:**");
      expect(state).toContain("- Main Hand: Rapier *(weapon)*");
      expect(state).not.toContain("Equipment Status Unconfirmed");
      expect(state).not.toContain("Broken Bow");
    });

    it("sole inventory item with zero quantity is not equipped and results in empty inventory", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          inventory: [
            {
              id: "item-depleted-only",
              name: "Ghost Blade",
              type: "weapon",
              quantity: 0,
              properties: {},
              equippedSlot: "MAIN_HAND",
            },
          ],
        },
      };

      const state = formatCanonicalState(context);
      expect(state).not.toContain("**Equipped:**");
      expect(state).not.toContain("Ghost Blade");
      expect(state).toContain("**Inventory:** (empty)");
    });

    it("zero-quantity unequipped item in bag is omitted from stowed inventory", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          inventory: [
            {
              id: "item-stowed-depleted",
              name: "Spent Wand",
              type: "misc",
              quantity: 0,
              properties: {},
              equippedSlot: null,
            },
          ],
        },
      };

      const state = formatCanonicalState(context);
      expect(state).not.toContain("Spent Wand");
      expect(state).toContain("**Inventory:** (empty)");
    });

    it("negative quantity equipped item is ignored and not equipped", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          inventory: [
            {
              id: "item-negative",
              name: "Corrupt Item",
              type: "weapon",
              quantity: -1,
              properties: {},
              equippedSlot: "MAIN_HAND",
            },
          ],
        },
      };

      const state = formatCanonicalState(context);
      expect(state).not.toContain("**Equipped:**");
      expect(state).not.toContain("Corrupt Item");
      expect(state).toContain("**Inventory:** (empty)");
    });
  });

  describe("P2-9: Concentration presence must mirror backend truthiness", () => {
    it("omits concentration line when null", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          concentrationSpellId: null,
        },
      };
      const state = formatCanonicalState(context);
      expect(state).not.toContain("Concentration");
    });

    it("omits concentration line when empty string", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          concentrationSpellId: "",
        },
      };
      const state = formatCanonicalState(context);
      expect(state).not.toContain("Concentration");
    });

    it("renders Active and hides raw ID when concentrationSpellId is a UUID", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          concentrationSpellId: "spell_uuid_123",
        },
      };
      const state = formatCanonicalState(context);
      expect(state).toContain("**Concentration:** Active");
      expect(state).not.toContain("spell_uuid_123");
    });

    it("renders Active and hides raw value when concentrationSpellId is whitespace-only", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          concentrationSpellId: "   ",
        },
      };
      const state = formatCanonicalState(context);
      expect(state).toContain("**Concentration:** Active");
    });
  });

  describe("P2-10: Do not expose unsupported exhaustion tiers as canonical mechanics", () => {
    it("omits active exhaustion line when level 0", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          exhaustionLevel: 0,
        },
      };
      const state = formatCanonicalState(context);
      expect(state).not.toContain("Exhaustion");
    });

    it("renders supported backend effect without numeric level when level 1", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          exhaustionLevel: 1,
        },
      };
      const state = formatCanonicalState(context);
      expect(state).toContain("**Exhaustion:** Active — ability checks are at disadvantage.");
      expect(state).not.toContain("Level 1");
    });

    it("renders same supported effect wording without numeric level when level 2", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          exhaustionLevel: 2,
        },
      };
      const state = formatCanonicalState(context);
      expect(state).toContain("**Exhaustion:** Active — ability checks are at disadvantage.");
      expect(state).not.toContain("Level 2");
    });

    it("renders same supported effect wording without numeric level when level 6", () => {
      const context: CampaignContext = {
        ...baseContext,
        character: {
          ...baseCharacter,
          exhaustionLevel: 6,
        },
      };
      const state = formatCanonicalState(context);
      expect(state).toContain("**Exhaustion:** Active — ability checks are at disadvantage.");
      expect(state).not.toContain("Level 6");
    });

    it("formatSurvivalHUD renders only supported backend effect and no numeric tier for exhaustionLevel 3", () => {
      const hud = formatSurvivalHUD({
        ...baseHUD,
        exhaustionLevel: 3,
      });
      expect(hud).toContain("**Exhaustion:** Active — ability checks are at disadvantage.");
      expect(hud).not.toContain("Level 3");
      expect(hud).not.toContain("3/6");
    });

    it("formatSurvivalHUD omits exhaustion line when level 0", () => {
      const hud = formatSurvivalHUD({
        ...baseHUD,
        exhaustionLevel: 0,
      });
      expect(hud).not.toContain("Exhaustion");
    });
  });
});
