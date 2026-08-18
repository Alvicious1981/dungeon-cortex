import { describe, expect, it } from "vitest";

import {
  DIFFICULTY_DC,
  contestedCheckDC,
  passiveSkillScore,
  resolveAbilityCheck,
  type AbilityCheckActor,
} from "@/lib/rules/ability-check";
import { IMPROVISED_ACTIONS, matchImprovisedAction } from "@/lib/rules/improvised-actions";
import { isUnawareOfSurroundings } from "@/lib/rules/conditions";

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

  it("informa de una característica ausente como desconocida, no como 10", () => {
    // Un 10 inventado se lee como "criatura del montón" y produce CD 10, por
    // debajo de la CD 15 sin oposición: ser vigilado saldría más barato que
    // estar solo. Falta de dato es null.
    expect(passiveSkillScore({}, "Perception")).toBeNull();
    expect(passiveSkillScore({ STR: 18 }, "Perception")).toBeNull();
  });

  it("descarta valores que no son números finitos", () => {
    // stats es JSON sin validar. Sin esto, NaN se propaga a la CD y ninguna
    // tirada puede tener éxito, con "vs DC NaN" en el registro.
    expect(passiveSkillScore({ WIS: "14" } as never, "Perception")).toBeNull();
    expect(passiveSkillScore({ WIS: NaN }, "Perception")).toBeNull();
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

  it("sin oponentes no hay número que devolver", () => {
    expect(contestedCheckDC({ opponents: [], skills: ["Perception"] })).toBeNull();
  });

  it("oponentes sin datos relevantes cuentan como ausencia de contienda", () => {
    // El caso real: los enemigos creados por la ruta de encuentro se guardaban
    // con stats vacío. Tratarlos como promedio daba CD 10 a todo.
    expect(contestedCheckDC({ opponents: [{}, {}], skills: ["Perception"] })).toBeNull();
  });

  it("un oponente con datos manda aunque otro no los tenga", () => {
    expect(
      contestedCheckDC({ opponents: [{}, { WIS: 16 }], skills: ["Perception"] })
    ).toBe(13);
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

  it("oponentes sin características no abaratan la acción por debajo de la banda", () => {
    // La regresión concreta: esconderse ante un combatiente con stats vacío
    // daba CD 10, más fácil que esconderse sin nadie delante (CD 15).
    const watched = resolveAbilityCheck(
      { skill: "Stealth", band: "medium", opposition: { opponents: [{}], skills: ["Perception"] } },
      hero
    );
    const alone = resolveAbilityCheck({ skill: "Stealth", band: "medium" }, hero);

    expect(watched.dcSource).toBe("band");
    expect(watched.dc).toBe(alone.dc);
    expect(watched.dc).toBe(DIFFICULTY_DC.medium);
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
    ["I pickpocket the merchant", "Sleight of Hand", "target"],
    ["I lie to the guard", "Deception", "target"],
    ["I shove the goblin", "Athletics", "target"],
  ])("%s se resuelve como contienda", (input, skill, scope) => {
    const action = matchImprovisedAction(input)?.action;
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
    expect(matchImprovisedAction(input)?.action.opposedBy).toBeUndefined();
  });

  it("toda oposición declarada nombra habilidades y un alcance válidos", () => {
    for (const action of IMPROVISED_ACTIONS) {
      if (!action.opposedBy) continue;
      expect(action.opposedBy.skills.length).toBeGreaterThan(0);
      expect(["observers", "target"]).toContain(action.opposedBy.scope);
    }
  });
});

describe("quién puede oponerse", () => {
  it.each(["unconscious", "petrified", "Unconscious"])(
    "%s deja a la criatura sin capacidad de notar nada",
    (condition) => {
      expect(isUnawareOfSurroundings([condition])).toBe(true);
    }
  );

  it.each(["stunned", "paralyzed", "incapacitated", "restrained", "charmed"])(
    "%s impide actuar, no percibir",
    (condition) => {
      // Un guardia aturdido no puede reaccionar, pero sigue mirando la sala.
      // Excluirlo dejaría colarse delante de sus narices.
      expect(isUnawareOfSurroundings([condition])).toBe(false);
    }
  );

  it.each(["blinded", "deafened"])(
    "%s no basta: le queda el otro sentido",
    (condition) => {
      // Cegado sigue oyendo y ensordecido sigue viendo. Excluirlos permitiría
      // esconderse a plena vista de quien conserva el oído intacto. Modelarlo
      // bien exige saber de qué sentido depende cada prueba, que no está
      // representado en ninguna parte.
      expect(isUnawareOfSurroundings([condition])).toBe(false);
    }
  );

  it("ignora condiciones desconocidas y listas vacías", () => {
    expect(isUnawareOfSurroundings([])).toBe(false);
    expect(isUnawareOfSurroundings(["no-such-condition"])).toBe(false);
  });
});

describe("alcance de la oposición", () => {
  it("esconderse lo notan todos; robar y mentir, solo el afectado", () => {
    // El SRD enfrenta el hurto a la Percepción del propio incauto y la mentira
    // a la Perspicacia de quien la escucha, no a la del transeúnte más agudo.
    const scopeOf = (input: string) =>
      matchImprovisedAction(input)?.action.opposedBy?.scope;

    expect(scopeOf("I hide behind the crates")).toBe("observers");
    expect(scopeOf("I pickpocket the merchant")).toBe("target");
    expect(scopeOf("I lie to the guard")).toBe("target");
    expect(scopeOf("I shove the goblin")).toBe("target");
  });
});

describe("texto que sigue al verbo", () => {
  it.each([
    ["I pickpocket the merchant", "the merchant"],
    ["I lie to the guard", "to the guard"],
    ["I shove the goblin", "the goblin"],
    ["robo al mercader", "al mercader"],
    ["miento al guardia", "al guardia"],
  ])("%s deja %s", (input, rest) => {
    expect(matchImprovisedAction(input)?.rest).toBe(rest);
  });

  it("el envoltorio de intento no contamina el resto", () => {
    // "I try to shove the goblin" debe dejar lo mismo que "I shove the goblin",
    // no un resto que aún arrastre el marco de la frase.
    expect(matchImprovisedAction("I try to shove the goblin")?.rest).toBe("the goblin");
    expect(matchImprovisedAction("intento empujar al goblin")?.rest).toBe("al goblin");
  });

  it("un verbo solo no deja resto", () => {
    expect(matchImprovisedAction("I hide")?.rest).toBeUndefined();
  });
});
