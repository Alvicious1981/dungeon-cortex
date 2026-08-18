import { describe, expect, it } from "vitest";

import {
  CONDITION_REGISTRY,
  evaluateAbilityCheckAdvantage,
} from "@/lib/rules/conditions";

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
