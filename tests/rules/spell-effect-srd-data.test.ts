import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveSpellEffect } from "@/lib/rules/magic";
import { ABILITIES } from "@/lib/rules/ability-check";
import { executeCombatAction } from "@/lib/rules/combat-pipeline";
import {
  buildEncounter,
  buildEnemy,
  buildMockTx,
  buildPlayer,
} from "./combat-pipeline-fixtures";

/**
 * `resolveSpellEffect` against the spell records the game actually casts, not
 * hand-written ones. Every earlier test fed it `saveAbility: "DEX"` while the
 * data says `"dex"`, so the pipeline's lookup into a creature's `WIS`/`DEX`
 * scores missing on every real spell stayed green for as long as it existed.
 */
const SPELLS = JSON.parse(
  readFileSync(join(process.cwd(), "data", "srd-es", "spells.json"), "utf8"),
) as Array<Record<string, unknown>>;

function spell(index: string): Record<string, unknown> {
  const found = SPELLS.find((s) => s.index === index);
  if (!found) throw new Error(`spell ${index} is not in data/srd-es/spells.json`);
  return found;
}

function levelOf(record: Record<string, unknown>): number {
  return Number(record.level ?? record.nivel ?? 0);
}

function dcIndexOf(record: Record<string, unknown>): string | null {
  const dc = record.dc as { dc_type?: { index?: unknown } } | null | undefined;
  return typeof dc?.dc_type?.index === "string" ? dc.dc_type.index : null;
}

function hasTypedDamage(record: Record<string, unknown>): boolean {
  const damage = record.damage as { damage_type?: { index?: unknown } } | null | undefined;
  return typeof damage?.damage_type?.index === "string";
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveSpellEffect — the saving throw ability, from the real SRD data", () => {
  const damageSpellsWithSave = SPELLS.filter((s) => hasTypedDamage(s) && dcIndexOf(s));

  it("covers a real population, not an empty filter", () => {
    expect(damageSpellsWithSave.length).toBeGreaterThan(40);
  });

  it("spells every save the way Combatant.stats keys an ability score", () => {
    for (const record of damageSpellsWithSave) {
      const effect = resolveSpellEffect(record, Math.max(1, levelOf(record)), 0, 20);
      expect(effect.hasSavingThrow, String(record.index)).toBe(true);
      expect(ABILITIES, String(record.index)).toContain(effect.saveAbility);
      expect(effect.saveAbility, String(record.index)).toBe(
        dcIndexOf(record)!.toUpperCase(),
      );
    }
  });

  it("rolls a creature's save with its own score, not a default of 10", async () => {
    // Thunderwave, as stored: 2d8 thunder, CON save, half on success.
    const effect = resolveSpellEffect(spell("thunderwave"), 1, 3, 1);
    const enemy = buildEnemy({
      hp: 50,
      maxHp: 50,
      stats: { STR: 10, DEX: 10, CON: 30, INT: 10, WIS: 10, CHA: 10 },
    });

    // d20 → 5; +10 from CON 30 makes 15, which beats DC 13. At the +0 the
    // lookup used to find, the same die fails. Then 2d8 → 8 + 8, location.
    let i = 0;
    const rolls = [0.2, 0.99, 0.99, 0.0];
    vi.spyOn(Math, "random").mockImplementation(() => rolls[i++] ?? 0.5);

    const outcome = await executeCombatAction(
      {
        actionType: "cast_spell",
        encounter: buildEncounter([buildPlayer(), enemy]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [enemy],
        spellName: "Thunderwave",
        spellLevel: 0,
        spellEffect: effect,
        spellSaveDC: 13,
      },
      buildMockTx(),
    );

    expect(outcome.totalDamageDealt).toBe(8);
  });
});

describe("resolveSpellEffect — dice that are not damage of any type", () => {
  it("are exactly Sleep's hit-point pool and Prismatic Spray's per-ray damage", () => {
    const untyped = SPELLS.filter((s) => s.damage && !hasTypedDamage(s)).map((s) => s.index);
    expect(untyped.sort()).toEqual(["prismatic-spray", "sleep"]);
  });

  it("does not resolve Sleep's hit-point pool as damage", () => {
    const effect = resolveSpellEffect(spell("sleep"), 1, 3, 1);
    expect(effect.type).not.toBe("damage");
    expect(effect.dice).toBeNull();
  });

  it("does not resolve Prismatic Spray's 10d6 as damage of no type", () => {
    const effect = resolveSpellEffect(spell("prismatic-spray"), 7, 3, 13);
    expect(effect.type).not.toBe("damage");
    expect(effect.dice).toBeNull();
  });

  it("leaves a cast of Sleep dealing no damage to its target", async () => {
    const enemy = buildEnemy();
    const outcome = await executeCombatAction(
      {
        actionType: "cast_spell",
        encounter: buildEncounter([buildPlayer(), enemy]),
        actorId: "player-1",
        actorName: "Aldric",
        actorConditions: [],
        targetCombatants: [enemy],
        spellName: "Sleep",
        spellLevel: 0,
        spellEffect: resolveSpellEffect(spell("sleep"), 1, 3, 1),
        spellSaveDC: 13,
      },
      buildMockTx(),
    );

    expect(outcome.totalDamageDealt).toBe(0);
  });

  it("still resolves every spell whose damage names a type as damage", () => {
    for (const record of SPELLS.filter(hasTypedDamage)) {
      const effect = resolveSpellEffect(record, 9, 0, 20);
      expect(effect.type, String(record.index)).toBe("damage");
    }
  });
});
