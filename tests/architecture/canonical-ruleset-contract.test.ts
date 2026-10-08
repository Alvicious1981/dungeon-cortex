/**
 * tests/architecture/canonical-ruleset-contract.test.ts
 *
 * Test arquitectónico estático que garantiza que el modelo Prisma de reglas
 * canónicas cumple estrictamente las leyes del sistema:
 * 1. Aislamiento por Ruleset (claves compuestas con rulesetId).
 * 2. Integridad referencial entre habilidades y características por ruleset.
 * 3. Seguridad de transición no destructiva (los campos legacy de Character siguen presentes).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCHEMA_PATH = join(ROOT, "prisma", "schema.prisma");
const SCHEMA = readFileSync(SCHEMA_PATH, "utf8");

describe("Contrato Arquitectónico de Reglas Canónicas (schema.prisma)", () => {
  it("declara el modelo Ruleset con identificación explícita y colecciones canónicas", () => {
    expect(SCHEMA).toMatch(/model\s+Ruleset\s*\{[\s\S]*?id\s+String\s+@id/);
    expect(SCHEMA).toMatch(/model\s+Ruleset\s*\{[\s\S]*?sources\s+RuleSource\[\]/);
    expect(SCHEMA).toMatch(/model\s+Ruleset\s*\{[\s\S]*?abilities\s+CanonicalAbility\[\]/);
    expect(SCHEMA).toMatch(/model\s+Ruleset\s*\{[\s\S]*?skills\s+CanonicalSkill\[\]/);
    expect(SCHEMA).toMatch(/model\s+Ruleset\s*\{[\s\S]*?languages\s+CanonicalLanguage\[\]/);
  });

  it("garantiza que RuleSource vincula su código a rulesetId en una clave única", () => {
    expect(SCHEMA).toMatch(/model\s+RuleSource\s*\{[\s\S]*?@@unique\(\[rulesetId,\s*code\]\)/);
  });

  it("garantiza que CanonicalAbility utiliza clave primaria compuesta (rulesetId, code)", () => {
    expect(SCHEMA).toMatch(/model\s+CanonicalAbility\s*\{[\s\S]*?@@id\(\[rulesetId,\s*code\]\)/);
  });

  it("garantiza que CanonicalSkill utiliza clave compuesta y FK compuesta hacia CanonicalAbility", () => {
    expect(SCHEMA).toMatch(/model\s+CanonicalSkill\s*\{[\s\S]*?@@id\(\[rulesetId,\s*code\]\)/);
    // FK compuesta para que una habilidad solo pueda pertenecer a una característica del MISMO ruleset:
    expect(SCHEMA).toMatch(
      /model\s+CanonicalSkill\s*\{[\s\S]*?fields:\s*\[rulesetId,\s*abilityCode\],\s*references:\s*\[rulesetId,\s*code\]/,
    );
  });

  it("garantiza que CanonicalLanguage utiliza clave primaria compuesta (rulesetId, code)", () => {
    expect(SCHEMA).toMatch(/model\s+CanonicalLanguage\s*\{[\s\S]*?@@id\(\[rulesetId,\s*code\]\)/);
  });

  it("preserva los campos transicionales legacy de Character intactos durante la Fase 1", () => {
    const characterBlockMatch = SCHEMA.match(/model\s+Character\s*\{([\s\S]*?)\n\}/);
    expect(characterBlockMatch).not.toBeNull();
    const characterBody = characterBlockMatch![1];

    expect(characterBody).toMatch(/\brace\s+String\b/);
    expect(characterBody).toMatch(/\bclass\s+String\b/);
    expect(characterBody).toMatch(/\bstats\s+Json\b/);
    expect(characterBody).toMatch(/\bspellSlots\s+Json\?/);
    expect(characterBody).toMatch(/\bskillProficiencies\s+Json\?/);
  });
});
