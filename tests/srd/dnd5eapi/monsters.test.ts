import { describe, expect, it, vi } from "vitest";

import { Dnd5eApiClientError } from "@/lib/srd/dnd5eapi/client";
import {
  adaptMonster,
  createDnd5eApiMonstersAdapter,
} from "@/lib/srd/dnd5eapi/monsters";

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const goblinMonster = {
  index: "goblin",
  name: "Goblin",
  size: "Small",
  type: "humanoid",
  alignment: "neutral evil",
  armor_class: [
    {
      type: "armor",
      value: 15,
      desc: "leather armor, shield",
    },
  ],
  hit_points: 7,
  hit_dice: "2d6",
  speed: {
    walk: "30 ft.",
    climb: "15 ft.",
  },
  strength: 8,
  dexterity: 14,
  constitution: 10,
  intelligence: 10,
  wisdom: 8,
  charisma: 8,
  proficiencies: [
    {
      value: 2,
      proficiency: {
        index: "saving-throw-con",
        name: "Saving Throw: CON",
        url: "/api/2014/proficiencies/saving-throw-con",
      },
    },
    {
      value: 6,
      proficiency: {
        index: "skill-perception",
        name: "Skill: Perception",
        url: "/api/2014/proficiencies/skill-perception",
      },
    },
  ],
  senses: {
    darkvision: "60 ft.",
    passive_perception: 12,
  },
  languages: "Common, Goblin",
  challenge_rating: 0.25,
  proficiency_bonus: 2,
  xp: 50,
  special_abilities: [
    {
      name: "Nimble Escape",
      desc: "The goblin can take the Disengage or Hide action as a bonus action on each of its turns.",
    },
  ],
  actions: [
    {
      name: "Scimitar",
      desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 slashing damage.",
      attack_bonus: 4,
      damage: [
        {
          damage_dice: "1d6+2",
          damage_type: {
            index: "slashing",
            name: "Slashing",
            url: "/api/2014/damage-types/slashing",
          },
        },
      ],
    },
    {
      name: "Blinding Spittle",
      desc: "The target must succeed on a saving throw or be blinded.",
      dc: {
        dc_type: {
          index: "dex",
          name: "DEX",
          url: "/api/2014/ability-scores/dex",
        },
        dc_value: 12,
        success_type: "none",
      },
      usage: {
        type: "recharge on roll",
        dice: "1d6",
        min_value: 5,
      },
    },
  ],
  url: "/api/2014/monsters/goblin",
  updated_at: "2025-01-01T00:00:00.000Z",
};

const minimalMonster = {
  index: "commoner",
  name: "Commoner",
  size: "Medium",
  type: "humanoid",
  alignment: "any alignment",
  armor_class: 10,
  hit_points: 4,
  hit_dice: "1d8",
  speed: { walk: "30 ft." },
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
  senses: { passive_perception: "10" },
  languages: "any one language",
  challenge_rating: 0,
  xp: 10,
  url: "/api/2014/monsters/commoner",
};

describe("dnd5eapi monsters adapter", () => {
  it("lists monsters from the index without hydrating details", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 2,
        results: [
          { index: "goblin", name: "Goblin", url: "/api/2014/monsters/goblin" },
          { index: "commoner", name: "Commoner", url: "/api/2014/monsters/commoner" },
        ],
      }),
    );
    const adapter = createDnd5eApiMonstersAdapter({ fetch: fetchMock });

    await expect(adapter.listMonsters()).resolves.toEqual([
      { index: "goblin", name: "Goblin", url: "/api/2014/monsters/goblin" },
      { index: "commoner", name: "Commoner", url: "/api/2014/monsters/commoner" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.dnd5eapi.co/api/2014/monsters",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("gets and normalizes an individual monster", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(goblinMonster));
    const adapter = createDnd5eApiMonstersAdapter({ fetch: fetchMock });

    await expect(adapter.getMonster("goblin")).resolves.toMatchObject({
      index: "goblin",
      name: "Goblin",
      source: "dnd5eapi",
      sourceUrl: "/api/2014/monsters/goblin",
      sourceVersion: "2014",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.dnd5eapi.co/api/2014/monsters/goblin",
      expect.any(Object),
    );
  });

  it("normalizes armor_class as an array and speed as a record", () => {
    const monster = adaptMonster(goblinMonster);

    expect(monster.armorClass).toEqual([
      { type: "armor", value: 15, desc: "leather armor, shield" },
    ]);
    expect(monster.speed).toEqual({ walk: "30 ft.", climb: "15 ft." });
    expect(monster.senses).toEqual({ darkvision: "60 ft.", passive_perception: 12 });
  });

  it("normalizes challenge_rating, xp, proficiencies, traits, and actions", () => {
    const monster = adaptMonster(goblinMonster);

    expect(monster.challengeRating).toBe(0.25);
    expect(monster.proficiencyBonus).toBe(2);
    expect(monster.xp).toBe(50);
    expect(monster.savingThrows).toEqual({ con: 2 });
    expect(monster.skills).toEqual({ perception: 6 });
    expect(monster.traits).toEqual([
      {
        name: "Nimble Escape",
        description:
          "The goblin can take the Disengage or Hide action as a bonus action on each of its turns.",
      },
    ]);
    expect(monster.actions).toEqual([
      {
        name: "Scimitar",
        description:
          "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 slashing damage.",
        attackBonus: 4,
        damage: [
          {
            damageDice: "1d6+2",
            damageType: {
              index: "slashing",
              name: "Slashing",
              url: "/api/2014/damage-types/slashing",
            },
          },
        ],
      },
      {
        name: "Blinding Spittle",
        description: "The target must succeed on a saving throw or be blinded.",
        dc: {
          dcType: {
            index: "dex",
            name: "DEX",
            url: "/api/2014/ability-scores/dex",
          },
          dcValue: 12,
          successType: "none",
        },
        usage: {
          type: "recharge on roll",
          dice: "1d6",
          minValue: 5,
        },
      },
    ]);
  });

  it("allows optional monster fields to be absent", () => {
    expect(adaptMonster(minimalMonster)).toMatchObject({
      index: "commoner",
      armorClass: [{ value: 10 }],
      savingThrows: {},
      skills: {},
      traits: [],
      actions: [],
      source: "dnd5eapi",
      sourceVersion: "2014",
    });
  });

  it("rejects invalid monster response shapes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ...goblinMonster,
        armor_class: "not armor class",
      }),
    );
    const adapter = createDnd5eApiMonstersAdapter({ fetch: fetchMock });

    await expect(adapter.getMonster("goblin")).rejects.toMatchObject({
      name: "Dnd5eApiClientError",
      kind: "invalid-shape",
    } satisfies Partial<Dnd5eApiClientError>);
  });

  it("propagates controlled HTTP errors from the client", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: "missing" }, { status: 404, statusText: "Not Found" }),
    );
    const adapter = createDnd5eApiMonstersAdapter({ fetch: fetchMock });

    await expect(adapter.getMonster("missing")).rejects.toMatchObject({
      name: "Dnd5eApiClientError",
      kind: "http",
      status: 404,
    } satisfies Partial<Dnd5eApiClientError>);
  });

  it("uses only the injected fetch mock and never calls global fetch", async () => {
    const globalFetchSpy = vi.spyOn(globalThis, "fetch");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(goblinMonster));
    const adapter = createDnd5eApiMonstersAdapter({ fetch: fetchMock });

    await adapter.getMonster("goblin");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(globalFetchSpy).not.toHaveBeenCalled();
    globalFetchSpy.mockRestore();
  });
});
