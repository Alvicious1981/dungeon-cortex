/**
 * Architectural fences for the Model E level-up presentation detector.
 *
 * These read source text rather than behaviour: they exist to make a
 * regression loud at review time, not to exercise a code path.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const modulePath = join(
  process.cwd(),
  "lib",
  "actions",
  "backend-presentation-resolution.ts"
);
const source = readFileSync(modulePath, "utf8");

describe("backend-presentation-resolution: read-only, backend-derived, no applied outcome", () => {
  it("performs no database writes", () => {
    expect(source).not.toMatch(/\bprisma\b/);
    expect(source).not.toMatch(/\.(create|update|updateMany|upsert|delete|deleteMany)\s*\(/);
  });

  it("does not import the AI layer", () => {
    expect(source).not.toMatch(/from\s+["']@\/lib\/ai\//);
  });

  it("does not roll dice or compute an applied hit-point outcome", () => {
    expect(source).not.toMatch(/\broll\s*\(/);
    expect(source).not.toMatch(/\brollHitPointGain\s*\(/);
    expect(source).not.toMatch(/\bbuildLevelUpPayload\s*\(/);
  });

  it("does not accept a request/body parameter", () => {
    expect(source).not.toMatch(/\bNextRequest\b/);
    expect(source).not.toMatch(/\breq\.json\s*\(/);
    expect(source).not.toMatch(/\bbody\s*:/);
  });

  it("does not apply a level-up itself", () => {
    expect(source).not.toMatch(/\bapplyLevelUp\s*\(/);
  });

  it("the payload schema declares no applied-outcome fields", () => {
    const schemaStart = source.indexOf("LevelUpAvailablePayloadSchema");
    const schemaBlock = source.slice(schemaStart, source.indexOf("});", schemaStart));

    for (const appliedField of ["hpRoll", "hpGained", "newMaxHp", "newHitDiceTotal"]) {
      expect(schemaBlock).not.toContain(appliedField);
    }
  });

  it("the payload type is inferred from the schema, not a hand-written duplicate", () => {
    // A separately declared interface could drift from the schema and smuggle
    // in an applied-outcome field the schema itself forbids.
    expect(source).toMatch(
      /export type LevelUpAvailablePayload = z\.infer<typeof LevelUpAvailablePayloadSchema>;/
    );
  });

  it("requiresPlayerConfirmation is fixed to true, not derived from input", () => {
    expect(source).toMatch(/requiresPlayerConfirmation:\s*z\.literal\(true\)/);
    expect(source).toMatch(/requiresPlayerConfirmation:\s*true/);
  });

  it("derives targetLevel from the canonical XP helper, not a restated table", () => {
    expect(source).toMatch(/from\s+["']@\/lib\/rules\/progression["']/);
    expect(source).toMatch(/\bgetLevelFromXP\s*\(/);
    expect(source).not.toMatch(/\bXP_THRESHOLDS\b/);
  });
});
