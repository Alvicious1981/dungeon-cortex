/**
 * tests/architecture/canonical-character-abilities-contract.test.ts
 *
 * Test arquitectónico que verifica el contrato de modelos de CharacterAbility
 * y CharacterSkillProficiency en schema.prisma.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCHEMA_PATH = join(ROOT, "prisma", "schema.prisma");
const SCHEMA = readFileSync(SCHEMA_PATH, "utf8");

describe("Contrato Arquitectónico de Características y Habilidades de Personaje", () => {
  it("declara el modelo CharacterAbility con integridad referencial compuesta", () => {
    expect(SCHEMA).toMatch(/model\s+CharacterAbility\s*\{/);
    expect(SCHEMA).toMatch(
      /model\s+CharacterAbility\s*\{[\s\S]*?@@unique\(\[characterId,\s*abilityCode\]\)/,
    );
    expect(SCHEMA).toMatch(
      /model\s+CharacterAbility\s*\{[\s\S]*?fields:\s*\[rulesetId,\s*abilityCode\],\s*references:\s*\[rulesetId,\s*code\]/,
    );
  });

  it("declara el modelo CharacterSkillProficiency con nivel y referencia a CanonicalSkill", () => {
    expect(SCHEMA).toMatch(/model\s+CharacterSkillProficiency\s*\{/);
    expect(SCHEMA).toMatch(
      /model\s+CharacterSkillProficiency\s*\{[\s\S]*?@@unique\(\[characterId,\s*skillCode\]\)/,
    );
    expect(SCHEMA).toMatch(
      /model\s+CharacterSkillProficiency\s*\{[\s\S]*?fields:\s*\[rulesetId,\s*skillCode\],\s*references:\s*\[rulesetId,\s*code\]/,
    );
  });

  it("vincula Character con sus colecciones canónicas abilities y skills", () => {
    const characterBlockMatch = SCHEMA.match(/model\s+Character\s*\{([\s\S]*?)\n\}/);
    expect(characterBlockMatch).not.toBeNull();
    const characterBody = characterBlockMatch![1];

    expect(characterBody).toMatch(/\babilities\s+CharacterAbility\[\]/);
    expect(characterBody).toMatch(/\bskills\s+CharacterSkillProficiency\[\]/);
  });

  it("mantiene la coexistencia transicional conservando stats y skillProficiencies en Character", () => {
    const characterBlockMatch = SCHEMA.match(/model\s+Character\s*\{([\s\S]*?)\n\}/);
    expect(characterBlockMatch).not.toBeNull();
    const characterBody = characterBlockMatch![1];

    expect(characterBody).toMatch(/\bstats\s+Json\b/);
    expect(characterBody).toMatch(/\bskillProficiencies\s+Json\?/);
  });
});
