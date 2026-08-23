import { describe, expect, it } from "vitest";
import { resolveAttackRoll } from "@/lib/rules/combat";

/**
 * The penalty has to survive four layers to reach the die. Each layer is a
 * place it can be dropped silently — the value would simply be `undefined`, the
 * types would still check, and every existing test would still pass.
 *
 * These assert on `AttackRollResult`'s own reported roll mode rather than on a
 * spy. `resolveAttackRoll` returns `advantage` and `disadvantage` as part of its
 * result, so the real outcome is observable without mocking the dice module —
 * and a spy on another module's export is exactly the kind of test that proves
 * less than it appears to.
 */

describe("resolveAttackRoll takes the armour penalty", () => {
  it("reports disadvantage when the flag is set", () => {
    expect(resolveAttackRoll(5, 10, [], [], true, undefined, true).disadvantage).toBe(true);
  });

  it("reports no disadvantage when it is not", () => {
    expect(resolveAttackRoll(5, 10, [], [], true, undefined, false).disadvantage).toBe(false);
  });

  it("defaults to no penalty when the parameter is omitted", () => {
    // Every existing call site omits it, so the default is what keeps this PR
    // from changing any attack that has no armour involved.
    expect(resolveAttackRoll(5, 10, [], [], true).disadvantage).toBe(false);
  });

  it("still reports the advantage a condition grants, which wins as it does today", () => {
    // NOTE: this asserts CURRENT behaviour, not the SRD. resolveAttackRoll
    // picks advantage outright when both are present (combat.ts:887) — it does
    // not cancel them, unlike resolveAbilityCheck:269 which does. That
    // divergence is pre-existing and out of scope; see the plan's "A rule this
    // codebase does not implement" note. Pinning it here means PR 3 changes it
    // deliberately rather than by accident.
    const result = resolveAttackRoll(5, 10, ["invisible"], [], true, undefined, true);
    expect(result.advantage).toBe(true);
    expect(result.disadvantage).toBe(true);
  });
});
