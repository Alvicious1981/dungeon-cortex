import { describe, expect, it } from "vitest";
import { resolveAttackRoll } from "@/lib/rules/combat";

/**
 * The last of the four layers the penalty crosses to reach the die.
 *
 * Every test here calls `resolveAttackRoll` directly, so this file covers only
 * that final hop: the flag arrives as a parameter and has to change the roll
 * mode. The earlier hops — payload into `computeConsequences`, and
 * `computeConsequences` into `resolveAttackRoll` — are covered in
 * `tests/rules/combat.test.ts` and `tests/rules/combat-pipeline.test.ts`.
 * Each hop is a place the value can be dropped silently: it would simply be
 * `undefined`, the types would still check, and every existing test would still
 * pass. That is why all three files exist rather than one.
 *
 * These assert on `AttackRollResult`'s own reported roll mode rather than on a
 * spy. `resolveAttackRoll` returns `advantage` and `disadvantage` as part of its
 * result, so the real outcome is observable without mocking the dice module —
 * and a spy on another module's export is exactly the kind of test that proves
 * less than it appears to.
 */

describe("resolveAttackRoll takes the armour penalty", () => {
  it("reports disadvantage when the flag is set", () => {
    expect(resolveAttackRoll(5, 10, [], [], true, true).disadvantage).toBe(true);
  });

  it("reports no disadvantage when it is not", () => {
    expect(resolveAttackRoll(5, 10, [], [], true, false).disadvantage).toBe(false);
  });

  it("defaults to no penalty when the parameter is omitted", () => {
    // Every existing call site omits it, so the default is what keeps this PR
    // from changing any attack that has no armour involved.
    expect(resolveAttackRoll(5, 10, [], [], true).disadvantage).toBe(false);
  });

  it("cancels against the advantage a condition grants into a normal roll", () => {
    // SRD: any advantage and any disadvantage cancel, however many of each.
    // This test used to pin the opposite — advantage winning outright — as a
    // known divergence from resolveAbilityCheck; it is now the rule.
    const result = resolveAttackRoll(5, 10, ["invisible"], [], true, true);
    expect(result.advantage).toBe(false);
    expect(result.disadvantage).toBe(false);
    expect(result.dice).toHaveLength(1);
  });
});
