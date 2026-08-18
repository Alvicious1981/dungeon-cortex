import { describe, expect, it } from "vitest";

import { SKILL_ABILITY, type Skill } from "@/lib/rules/ability-check";
import {
  CLASS_SKILL_PROFICIENCIES,
  defaultSkillProficiencies,
  parseSkillProficiencies,
} from "@/lib/rules/class-skills";

describe("defaults por clase", () => {
  it("solo concede habilidades SRD reales", () => {
    for (const skills of Object.values(CLASS_SKILL_PROFICIENCIES)) {
      for (const skill of skills) {
        expect(skill in SKILL_ABILITY).toBe(true);
      }
    }
  });

  it("no repite una habilidad dentro de la misma clase", () => {
    for (const [cls, skills] of Object.entries(CLASS_SKILL_PROFICIENCIES)) {
      expect(new Set(skills).size, cls).toBe(skills.length);
    }
  });

  it.each([
    ["fighter", 2],
    ["wizard", 2],
    ["bard", 3],
    ["ranger", 3],
    ["rogue", 4],
  ])("%s recibe el número de habilidades que le corresponde", (cls, count) => {
    expect(defaultSkillProficiencies(cls)).toHaveLength(count);
  });

  it("ignora mayúsculas y espacios sobrantes", () => {
    expect(defaultSkillProficiencies("  Fighter ")).toEqual(
      defaultSkillProficiencies("fighter")
    );
  });

  it("no inventa competencias para una clase desconocida", () => {
    // Un bono no ganado inflaría en silencio cada tirada del personaje.
    expect(defaultSkillProficiencies("necromancer")).toEqual([]);
    expect(defaultSkillProficiencies("")).toEqual([]);
  });
});

describe("lectura de la columna persistida", () => {
  it("acepta una lista válida", () => {
    expect(parseSkillProficiencies(["Athletics", "Perception"])).toEqual([
      "Athletics",
      "Perception",
    ]);
  });

  it("descarta entradas que no son habilidades SRD", () => {
    expect(
      parseSkillProficiencies(["Athletics", "Cocina", 42, null, "Perception"])
    ).toEqual(["Athletics", "Perception"]);
  });

  it("elimina duplicados", () => {
    expect(parseSkillProficiencies(["Stealth", "Stealth"])).toEqual(["Stealth"]);
  });

  it.each([[null], [undefined], ["Athletics"], [{}], [0]])(
    "degrada a sin competencia ante un valor inutilizable (%s)",
    (raw) => {
      expect(parseSkillProficiencies(raw)).toEqual([]);
    }
  );

  it("nunca concede una competencia a partir de datos corruptos", () => {
    const corrupto: unknown = { Athletics: true };
    const resultado: Skill[] = parseSkillProficiencies(corrupto);
    expect(resultado).toEqual([]);
  });
});
