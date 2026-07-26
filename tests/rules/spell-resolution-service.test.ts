import { describe, expect, it, vi } from "vitest";
import { resolveCachedSpell } from "@/lib/rules/spell-resolution-service";

interface SpellRow {
  id: string;
  indexSlug: string | null;
  name: string;
  level: number | null;
  concentration: boolean | null;
  data: Record<string, unknown>;
}

function createDb(rows: SpellRow[]) {
  return {
    srdSpell: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        rows.find((row) => row.id === where.id) ?? null
      ),
      findMany: vi.fn(
        async ({ where }: { where: { name: { contains: string } } }) => {
          const query = where.name.contains.toLowerCase();
          return rows.filter((row) => row.name.toLowerCase().includes(query));
        }
      ),
    },
  };
}

describe("resolveCachedSpell", () => {
  it("derives leveled damage and half-on-save behavior from the cached SRD payload", async () => {
    const db = createDb([
      {
        id: "fireball",
        indexSlug: "fireball",
        name: "Fireball",
        level: 3,
        concentration: false,
        data: {
          damage: {
            damage_type: { index: "fire" },
            damage_at_slot_level: { "3": "8d6", "4": "9d6" },
          },
          dc: { dc_type: { index: "dex" }, dc_success: "half" },
        },
      },
    ]);

    const result = await resolveCachedSpell({
      query: "fireball",
      slotLevel: 4,
      spellcastingMod: 4,
      characterLevel: 7,
      db,
    });

    expect(result).toMatchObject({
      id: "fireball",
      name: "Fireball",
      type: "damage",
      dice: "9d6",
      damageType: "fire",
      hasSavingThrow: true,
      saveAbility: "dex",
      saveDamage: "half",
      concentration: false,
      sourceEndpoint: "https://www.dnd5eapi.co/api/2014/spells/fireball",
    });
  });

  it("uses character-level scaling and no damage on a successful cantrip save", async () => {
    const db = createDb([
      {
        id: "acid-splash",
        indexSlug: "acid-splash",
        name: "Acid Splash",
        level: 0,
        concentration: false,
        data: {
          damage: {
            damage_type: { index: "acid" },
            damage_at_character_level: {
              "1": "1d6",
              "5": "2d6",
              "11": "3d6",
              "17": "4d6",
            },
          },
          dc: { dc_type: { index: "dex" }, dc_success: "none" },
        },
      },
    ]);

    const result = await resolveCachedSpell({
      query: "  aCiD   sPlAsH  ",
      slotLevel: 0,
      spellcastingMod: 3,
      characterLevel: 11,
      db,
    });

    expect(result).toMatchObject({
      dice: "3d6",
      saveDamage: "none",
      saveAbility: "dex",
    });
    expect(db.srdSpell.findMany).toHaveBeenCalledOnce();
  });

  it("returns null for a partial name even when it has a single candidate", async () => {
    const result = await resolveCachedSpell({
      query: "Fire",
      slotLevel: 3,
      spellcastingMod: 4,
      characterLevel: 5,
      db: createDb([
        {
          id: "fireball",
          indexSlug: "fireball",
          name: "Fireball",
          level: 3,
          concentration: false,
          data: {},
        },
      ]),
    });

    expect(result).toBeNull();
  });

  it("returns null when a partial name has multiple candidates", async () => {
    const result = await resolveCachedSpell({
      query: "Fire",
      slotLevel: 3,
      spellcastingMod: 4,
      characterLevel: 5,
      db: createDb([
        {
          id: "fire-bolt",
          indexSlug: "fire-bolt",
          name: "Fire Bolt",
          level: 0,
          concentration: false,
          data: {},
        },
        {
          id: "fireball",
          indexSlug: "fireball",
          name: "Fireball",
          level: 3,
          concentration: false,
          data: {},
        },
      ]),
    });

    expect(result).toBeNull();
  });

  it("returns null instead of inventing mechanics for a cache miss", async () => {
    const result = await resolveCachedSpell({
      query: "Unknown Spell",
      slotLevel: 1,
      spellcastingMod: 3,
      characterLevel: 3,
      db: createDb([]),
    });

    expect(result).toBeNull();
  });
});
