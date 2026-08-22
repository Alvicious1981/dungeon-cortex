import { describe, expect, it } from "vitest";

import {
  CONDITION_REGISTRY,
  evaluateAbilityCheckAdvantage,
} from "@/lib/rules/conditions";
import { weaponAttackBonus } from "@/lib/rules/weapon-profile";

/**
 * El agotamiento y varias condiciones dan desventaja en TODA prueba de
 * característica según el SRD 2014, y hasta ahora no se aplicaban nunca:
 * resolveAbilityCheck aceptaba advantage/disadvantage y nadie se los pasaba.
 */
describe("evaluateAbilityCheckAdvantage", () => {
  it("un personaje sano y descansado tira normal", () => {
    expect(evaluateAbilityCheckAdvantage([], 0)).toEqual({
      advantage: false,
      disadvantage: false,
    });
  });

  it.each([1, 2, 6])("el agotamiento de nivel %i da desventaja", (level) => {
    expect(evaluateAbilityCheckAdvantage([], level)).toEqual({
      advantage: false,
      disadvantage: true,
    });
  });

  it.each(["poisoned", "frightened"])("la condición %s da desventaja", (condition) => {
    expect(evaluateAbilityCheckAdvantage([condition], 0)).toEqual({
      advantage: false,
      disadvantage: true,
    });
  });

  it("acepta la condición en cualquier caja", () => {
    expect(evaluateAbilityCheckAdvantage(["Poisoned"], 0).disadvantage).toBe(true);
  });

  it("no acumula: varias fuentes siguen siendo una sola desventaja", () => {
    // En 5e la desventaja no se apila. El resultado con tres fuentes es
    // idéntico al de una, y esa igualdad es la regla que se está afirmando.
    const one = evaluateAbilityCheckAdvantage(["poisoned"], 0);
    const many = evaluateAbilityCheckAdvantage(["poisoned", "frightened"], 3);
    expect(many).toEqual(one);
  });

  it("ignora condiciones desconocidas en vez de fallar", () => {
    // Las condiciones llegan como JSON sin validar. Una entrada basura degrada
    // a "sin efecto", nunca a una penalización inventada ni a una excepción.
    expect(evaluateAbilityCheckAdvantage(["definitely-not-a-condition"], 0)).toEqual({
      advantage: false,
      disadvantage: false,
    });
  });

  it.each(["restrained", "prone", "blinded"])(
    "%s no penaliza pruebas: su desventaja es solo de ataque",
    (condition) => {
      // La distinción que obligó a una bandera nueva. Reutilizar
      // selfDisadvantageOnAttack habría penalizado aquí de más.
      expect(evaluateAbilityCheckAdvantage([condition], 0).disadvantage).toBe(false);
    }
  );

  it("mantiene separadas las dos banderas del registro", () => {
    expect(CONDITION_REGISTRY.restrained?.selfDisadvantageOnAttack).toBe(true);
    expect(CONDITION_REGISTRY.restrained?.selfDisadvantageOnAbilityCheck).toBeUndefined();
    expect(CONDITION_REGISTRY.poisoned?.selfDisadvantageOnAbilityCheck).toBe(true);
  });
});

describe("weaponAttackBonus replaces weaponAttackModifier", () => {
  const PROFILE = {
    category: "martial" as const,
    isRanged: false,
    traits: [] as readonly string[],
    damageDice: "1d8",
    damageType: "Slashing",
  };
  const NO_MOD = { STR: 10, DEX: 10 }; // ability modifier 0

  it.each([
    [1, 2],
    [4, 2],
    [5, 3],
    [9, 4],
    [13, 5],
    [20, 6],
  ])("a nivel %i el bono de competencia es +%i", (level, expected) => {
    // Estaba fijo a +2 en las dos rutas de ataque, así que desde nivel 5 toda
    // tirada salía corta. Con modificador 0, lo devuelto es la competencia.
    expect(
      weaponAttackBonus({
        profile: PROFILE,
        stats: NO_MOD,
        characterClass: "fighter",
        level,
      }).bonus,
    ).toBe(expected);
  });

  it("un modificador de característica negativo resta, no se ignora", () => {
    // Migrado de `weaponAttackModifier(-1, 1) === 1`: la aserción del caso
    // negativo se perdió al reescribir el bloque. STR 8 (-1) + competencia +2.
    expect(
      weaponAttackBonus({
        profile: PROFILE,
        stats: { STR: 8, DEX: 8 },
        characterClass: "fighter",
        level: 1,
      }).bonus,
    ).toBe(1);
  });

  it("suma el modificador de característica a la competencia", () => {
    expect(
      weaponAttackBonus({
        profile: PROFILE,
        stats: { STR: 16, DEX: 10 },
        characterClass: "fighter",
        level: 5,
      }).bonus,
    ).toBe(6); // +3 STR, +3 competencia
  });

  it.each([0, 21, NaN, undefined as unknown as number])(
    "un nivel inutilizable (%s) cae al suelo de nivel 1, nunca a NaN",
    (level) => {
      // Degradar conservador: nunca infla el ataque, y no propaga NaN a la
      // tirada como haría una fórmula aplicada a un nivel ausente.
      expect(
        weaponAttackBonus({
          profile: PROFILE,
          stats: NO_MOD,
          characterClass: "fighter",
          level,
        }).bonus,
      ).toBe(2);
    },
  );
});
