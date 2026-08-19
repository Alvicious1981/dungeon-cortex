import { describe, expect, it, vi } from "vitest";
import { parseSpellArea, parseSpellRange, resolveCachedSpell } from "@/lib/rules/spell-resolution-service";

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

describe("parseSpellArea", () => {
  it.each([
    ["esfera", "sphere"],
    ["sphere", "sphere"],
    ["cilindro", "sphere"],
    ["cylinder", "sphere"],
    ["cubo", "cube"],
    ["cube", "cube"],
    ["cuadrado", "cube"],
    ["cono", "cone"],
    ["cone", "cone"],
    ["line", "line"],
  ])("maps the SRD type %s to %s", (rawType, shape) => {
    // All ten strings observed in the live SrdSpell table. The column is
    // bilingual with neither language dominant, so both must map.
    const parsed = parseSpellArea({ type: rawType, size: 20 });
    expect(parsed.area).toEqual({ shape, sizeFt: 20 });
    expect(parsed.unsupportedType).toBeNull();
  });

  it("reports no area when the spell has none", () => {
    expect(parseSpellArea(undefined)).toEqual({ area: null, unsupportedType: null });
    expect(parseSpellArea(null)).toEqual({ area: null, unsupportedType: null });
  });

  it("fails closed on a type it does not know", () => {
    // Treating an unknown shape as "no area" would hand target selection back
    // to the client and reopen the hole this work exists to close.
    const parsed = parseSpellArea({ type: "hipercubo", size: 20 });
    expect(parsed.area).toBeNull();
    expect(parsed.unsupportedType).toBe("hipercubo");
  });

  it("fails closed on a size that is not a usable number", () => {
    expect(parseSpellArea({ type: "sphere", size: "veinte" }).area).toBeNull();
    expect(parseSpellArea({ type: "sphere" }).area).toBeNull();
  });
});

describe("parseSpellRange", () => {
  it.each([
    ["60 pies", 60],
    ["30 pies", 30],
    ["120 pies", 120],
    ["90 pies", 90],
    ["10 pies", 10],
    ["150 pies", 150],
    ["300 pies", 300],
    ["100 pies", 100],
    ["500 pies", 500],
    ["5 pies", 5],
    ["60 feet", 60],
  ])("reads %s as a distance of %i ft", (raw, feet) => {
    expect(parseSpellRange(raw).range).toEqual({
      kind: "distance",
      feetFromCaster: feet,
    });
  });

  it.each([
    ["1 milla", 5280],
    ["500 millas", 2_640_000],
  ])("converts %s to %i ft", (raw, feet) => {
    expect(parseSpellRange(raw).range).toEqual({
      kind: "distance",
      feetFromCaster: feet,
    });
  });

  it.each(["Toque", "Touch", "toque"])("reads %s as touch", (raw) => {
    expect(parseSpellRange(raw).range).toEqual({ kind: "touch" });
  });

  it.each(["Lanzador", "Personal", "Self", "Autolanzado"])(
    "reads %s as caster-only",
    (raw) => {
      expect(parseSpellRange(raw).range).toEqual({ kind: "self" });
    }
  );

  it.each([
    "Lanzador (línea recta de 60 pies)",
    "Lanzador (radio de 5 millas)",
    "Personal (radio de 15 pies)",
  ])("reads %s as caster-only despite containing a number", (raw) => {
    // The ordering trap. A parser that looks for "number + pies" first turns
    // Espíritus Guardianes into a 15 ft range, making a spell that emanates
    // from the caster aimable 15 ft away.
    expect(parseSpellRange(raw).range).toEqual({ kind: "self" });
  });

  it.each(["Vista", "Especial", "Ilimitado"])(
    "reports %s as unenforceable, carrying the raw value",
    (raw) => {
      expect(parseSpellRange(raw).range).toEqual({ kind: "unenforceable", raw });
    }
  );

  it("reports a missing range as unenforceable with a null raw", () => {
    // Distinct from "Ilimitado": that is the spell's rule, this is a data gap.
    expect(parseSpellRange(null).range).toEqual({ kind: "unenforceable", raw: null });
    expect(parseSpellRange(undefined).range).toEqual({ kind: "unenforceable", raw: null });
  });

  it("reports an unrecognised string as unenforceable rather than guessing", () => {
    expect(parseSpellRange("a un tiro de piedra").range).toEqual({
      kind: "unenforceable",
      raw: "a un tiro de piedra",
    });
  });

  it.each([
    ["Personal (radio de 15 pies)", { shape: "sphere", sizeFt: 15 }],
    ["Lanzador (radio de 5 millas)", { shape: "sphere", sizeFt: 26400 }],
    ["Lanzador (línea recta de 60 pies)", { shape: "line", sizeFt: 60 }],
  ])("extracts the area embedded in %s", (raw, area) => {
    // For Controlar el clima and Espíritus Guardianes this is the ONLY place
    // their area lives. Without it, Espíritus Guardianes — an ordinary combat
    // spell — falls to the no-area path and accepts the client's target list.
    expect(parseSpellRange(raw).embeddedArea).toEqual(area);
  });

  it("extracts no area when the range carries none", () => {
    expect(parseSpellRange("60 pies").embeddedArea).toBeNull();
    expect(parseSpellRange("Lanzador").embeddedArea).toBeNull();
    expect(parseSpellRange("Lanzador (algo indescriptible)").embeddedArea).toBeNull();
  });
});
