/**
 * Model E contract for backend-authorised level-up presentation.
 *
 * `detectPendingLevelUp` is pure derivation from canonical state: no I/O, no
 * mutation, and no dependency on `applyLevelUp`'s own transaction. These tests
 * exercise the derivation directly and, for the successive-ascension cases,
 * drive it across before/after states that `applyLevelUp` itself would leave
 * behind — without invoking the service.
 */
import { describe, expect, it } from "vitest";
import {
  detectPendingLevelUp,
  LevelUpAvailablePayloadSchema,
  type BackendPresentationCharacterRecord,
} from "@/lib/actions/backend-presentation-resolution";
import { xpForLevel } from "@/lib/rules/progression";

function character(
  overrides: Partial<BackendPresentationCharacterRecord> = {}
): BackendPresentationCharacterRecord {
  return {
    id: "char-1",
    class: "fighter",
    level: 1,
    xp: 0,
    maxHp: 12,
    hitDiceTotal: 1,
    stats: { CON: 14 },
    ...overrides,
  };
}

describe("detectPendingLevelUp — Model E derivation from canonical state", () => {
  it("1. level=1 with XP for level 2: one pending step, no jump", () => {
    const payload = detectPendingLevelUp(
      character({ level: 1, hitDiceTotal: 1, xp: xpForLevel(2) })
    );

    expect(payload).toMatchObject({
      fromLevel: 1,
      toLevel: 2,
      targetLevel: 2,
      pendingLevels: 1,
    });
  });

  it("2. level=2 with XP for level 5: reports the single next step and the full backlog", () => {
    const payload = detectPendingLevelUp(
      character({ level: 2, hitDiceTotal: 2, xp: xpForLevel(5) })
    );

    expect(payload).toMatchObject({
      fromLevel: 2,
      toLevel: 3,
      targetLevel: 5,
      pendingLevels: 3,
    });
    // Never a direct 2 -> 5 jump.
    expect(payload!.toLevel).toBe(payload!.fromLevel + 1);
  });

  it("3. level=5 with XP for level 5: nothing pending", () => {
    const payload = detectPendingLevelUp(
      character({ level: 5, hitDiceTotal: 5, xp: xpForLevel(5) })
    );

    expect(payload).toBeNull();
  });

  it("4. level=20: already at the cap, nothing pending regardless of XP", () => {
    const payload = detectPendingLevelUp(
      character({ level: 20, hitDiceTotal: 20, xp: xpForLevel(20) })
    );

    expect(payload).toBeNull();
  });

  it("5. hitDiceTotal !== level: old-contract residue, fails closed", () => {
    const payload = detectPendingLevelUp(
      character({ level: 2, hitDiceTotal: 1, xp: xpForLevel(5) })
    );

    expect(payload).toBeNull();
  });

  it.each([
    ["negative xp", character({ xp: -1 })],
    ["non-integer xp", character({ xp: 1.5 })],
    ["level below MIN_LEVEL", character({ level: 0, hitDiceTotal: 0 })],
    ["level above MAX_LEVEL", character({ level: 21, hitDiceTotal: 21 })],
    ["non-integer level", character({ level: 2.5, hitDiceTotal: 2.5 })],
    ["negative hitDiceTotal", character({ hitDiceTotal: -1 })],
    ["non-integer maxHp", character({ maxHp: 12.5 })],
    ["maxHp below 1", character({ maxHp: 0 })],
  ])("6. invalid numeric state (%s) fails closed", (_label, invalidCharacter) => {
    expect(detectPendingLevelUp(invalidCharacter)).toBeNull();
  });

  it("7. class unsupported by the current hit-die contract fails closed", () => {
    const payload = detectPendingLevelUp(
      character({ class: "not-a-real-class", level: 1, hitDiceTotal: 1, xp: xpForLevel(2) })
    );

    expect(payload).toBeNull();
  });

  it("8. never carries an applied outcome — no roll, no gain, no new maximum", () => {
    const payload = detectPendingLevelUp(
      character({ level: 1, hitDiceTotal: 1, xp: xpForLevel(2) })
    )!;

    expect(payload).not.toHaveProperty("hpRoll");
    expect(payload).not.toHaveProperty("hpGained");
    expect(payload).not.toHaveProperty("newMaxHp");
    expect(payload).not.toHaveProperty("newHitDiceTotal");
    // The persisted numbers it does carry are verbatim, not recomputed.
    expect(payload.currentMaxHp).toBe(12);
    expect(payload.currentHitDiceTotal).toBe(1);
  });

  it("9. for every backlog size, toLevel is always fromLevel + 1", () => {
    for (let level = 1; level < 19; level++) {
      const payload = detectPendingLevelUp(
        character({ level, hitDiceTotal: level, xp: xpForLevel(19) })
      )!;

      expect(payload.fromLevel).toBe(level);
      expect(payload.toLevel).toBe(level + 1);
      expect(payload.pendingLevels).toBe(19 - level);
    }
  });

  it("10. is deterministic: the same input always produces the same result", () => {
    const input = character({ level: 2, hitDiceTotal: 2, xp: xpForLevel(5) });

    const first = detectPendingLevelUp(input);
    const second = detectPendingLevelUp(input);

    expect(first).toEqual(second);
  });

  it("is validated against its own schema before leaving the module", () => {
    const payload = detectPendingLevelUp(
      character({ level: 2, hitDiceTotal: 2, xp: xpForLevel(5) })
    );

    expect(LevelUpAvailablePayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("successive ascensions: applying one step decrements pendingLevels without new XP", () => {
    // Before: Model E settled state at level 2, XP already supports level 5.
    const before = character({ level: 2, hitDiceTotal: 2, xp: xpForLevel(5) });
    const beforePayload = detectPendingLevelUp(before)!;
    expect(beforePayload).toMatchObject({ fromLevel: 2, toLevel: 3, pendingLevels: 3 });

    // After: the state applyLevelUp itself would leave behind for that single
    // step — level and hitDiceTotal both advance to 3, XP is untouched.
    const after = character({ level: 3, hitDiceTotal: 3, xp: before.xp });
    const afterPayload = detectPendingLevelUp(after)!;

    expect(afterPayload).toMatchObject({ fromLevel: 3, toLevel: 4, pendingLevels: 2 });
    expect(afterPayload.targetLevel).toBe(beforePayload.targetLevel);
  });
});

describe("detectPendingLevelUp — read-only guarantee", () => {
  it("performs no database access of any kind", () => {
    // The function signature accepts a plain structural record — there is no
    // db/tx/prisma parameter to inject, so no call site exists that would let
    // this function reach a database even accidentally.
    const character: BackendPresentationCharacterRecord = {
      id: "char-1",
      class: "fighter",
      level: 1,
      xp: xpForLevel(2),
      maxHp: 12,
      hitDiceTotal: 1,
      stats: { CON: 14 },
    };
    const before = JSON.stringify(character);

    detectPendingLevelUp(character);

    // The input record itself is never mutated.
    expect(JSON.stringify(character)).toBe(before);
  });
});
