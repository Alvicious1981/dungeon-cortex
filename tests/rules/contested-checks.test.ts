import { describe, expect, it } from "vitest";

import {
  DIFFICULTY_DC,
  contestedCheckDC,
  passiveSkillScore,
  resolveAbilityCheck,
  type AbilityCheckActor,
} from "@/lib/rules/ability-check";
import { IMPROVISED_ACTIONS, matchImprovisedAction } from "@/lib/rules/improvised-actions";

const hero: AbilityCheckActor = {
  stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
  level: 1,
};

describe("passiveSkillScore", () => {
  it("es 10 más el modificador de la característica de la habilidad", () => {
    // Percepción es Sabiduría: SAB 14 → +2 → 12.
    expect(passiveSkillScore({ WIS: 14 }, "Perception")).toBe(12);
    expect(passiveSkillScore({ WIS: 6 }, "Perception")).toBe(8);
  });

  it("trata una característica ausente como 10", () => {
    expect(passiveSkillScore({}, "Perception")).toBe(10);
  });

  it("usa la característica correcta de cada habilidad", () => {
    // Atletismo es Fuerza y Acrobacias Destreza: si se confundieran, una
    // criatura fuerte y torpe resistiría un empujón con el número equivocado.
    const brute = { STR: 18, DEX: 6 };
    expect(passiveSkillScore(brute, "Athletics")).toBe(14);
    expect(passiveSkillScore(brute, "Acrobatics")).toBe(8);
  });
});

describe("contestedCheckDC", () => {
  it("la criatura más capaz fija la dificultad", () => {
    // Colarse ante una patrulla cuesta lo que cueste su centinela más despierto,
    // no el promedio ni el primero de la lista.
    const dc = contestedCheckDC({
      opponents: [{ WIS: 8 }, { WIS: 18 }, { WIS: 10 }],
      skills: ["Perception"],
    });
    expect(dc).toBe(14);
  });

  it("la oposición elige la habilidad que mejor le sirve", () => {
    // El SRD deja resistir un empujón con Atletismo o Acrobacias. Un bruto
    // torpe resiste con su Fuerza; un acróbata débil, con su Destreza.
    const acrobat = { STR: 8, DEX: 18 };
    expect(
      contestedCheckDC({ opponents: [acrobat], skills: ["Athletics", "Acrobatics"] })
    ).toBe(14);
  });

  it("sin oposición devuelve la banda por defecto en vez de un DC 10 engañoso", () => {
    // Nadie resistiendo no significa "trivial": significa que no había contienda
    // y que quien llama debería haber usado una banda.
    expect(contestedCheckDC({ opponents: [], skills: ["Perception"] })).toBe(
      DIFFICULTY_DC.medium
    );
  });
});

describe("resolveAbilityCheck con oposición", () => {
  it("la contienda manda sobre la banda, y lo declara", () => {
    const result = resolveAbilityCheck(
      {
        skill: "Stealth",
        band: "very_easy", // sería CD 5; la contienda debe ignorarlo
        opposition: { opponents: [{ WIS: 16 }], skills: ["Perception"] },
      },
      hero
    );

    expect(result.dc).toBe(13);
    expect(result.dcSource).toBe("contest");
    // La banda se anula: informar "very_easy" junto a una CD 13 sería mentir
    // sobre de dónde salió el número.
    expect(result.band).toBeNull();
  });

  it("sin oponentes se resuelve por banda, no por contienda", () => {
    const result = resolveAbilityCheck(
      { skill: "Stealth", band: "hard", opposition: { opponents: [], skills: ["Perception"] } },
      hero
    );

    expect(result.dcSource).toBe("band");
    expect(result.band).toBe("hard");
    expect(result.dc).toBe(DIFFICULTY_DC.hard);
  });

  it("la misma acción cuesta distinto según a quién se enfrenta", () => {
    // El objetivo de todo esto: la dificultad deja de ser una etiqueta y pasa a
    // depender de la criatura concreta que hay delante.
    const alert = resolveAbilityCheck(
      { skill: "Stealth", opposition: { opponents: [{ WIS: 20 }], skills: ["Perception"] } },
      hero
    );
    const oblivious = resolveAbilityCheck(
      { skill: "Stealth", opposition: { opponents: [{ WIS: 4 }], skills: ["Perception"] } },
      hero
    );

    expect(alert.dc).toBeGreaterThan(oblivious.dc);
    expect(alert.dc).toBe(15);
    expect(oblivious.dc).toBe(7);
  });
});

describe("qué acciones son contiendas", () => {
  it.each([
    ["I hide behind the crates", "Stealth", "observers"],
    ["I pickpocket the merchant", "Sleight of Hand", "observers"],
    ["I lie to the guard", "Deception", "observers"],
    ["I shove the goblin", "Athletics", "single"],
  ])("%s se resuelve como contienda", (input, skill, scope) => {
    const action = matchImprovisedAction(input);
    expect(action?.skill).toBe(skill);
    expect(action?.opposedBy?.scope).toBe(scope);
  });

  it.each([
    "I climb the wall",
    "I force the door",
    "I search the room",
    "I stabilize the dying scout",
  ])("%s no es contienda: no hay criatura resistiéndose", (input) => {
    // Una puerta atrancada no tiene Percepción. Contestar contra ella exigiría
    // inventarle características, así que estas siguen usando su banda.
    expect(matchImprovisedAction(input)?.opposedBy).toBeUndefined();
  });

  it("toda oposición declarada nombra habilidades y un alcance válidos", () => {
    for (const action of IMPROVISED_ACTIONS) {
      if (!action.opposedBy) continue;
      expect(action.opposedBy.skills.length).toBeGreaterThan(0);
      expect(["observers", "single"]).toContain(action.opposedBy.scope);
    }
  });
});
