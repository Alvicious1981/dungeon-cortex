import { describe, expect, it } from "vitest";
import {
  DEATH_SAVE_LIMIT,
  DeathSaveInvariantError,
  derivePlayerLifeState,
  resolveDeathSave,
  resolveDownedBlow,
  shouldWake,
  stabilize,
} from "@/lib/rules/death-save";

describe("resolveDeathSave (SRD 2014)", () => {
  it("revives on a natural 20 whatever the counters", () => {
    expect(resolveDeathSave({ successes: 0, failures: 2 }, 20)).toEqual({ outcome: "revived" });
  });

  it("counts a natural 1 as two failures", () => {
    expect(resolveDeathSave({ successes: 1, failures: 0 }, 1)).toEqual({
      outcome: "dying", successes: 1, failures: 2,
    });
  });

  it("succeeds on exactly 10 and fails on 9", () => {
    expect(resolveDeathSave({ successes: 0, failures: 0 }, 10)).toEqual({
      outcome: "dying", successes: 1, failures: 0,
    });
    expect(resolveDeathSave({ successes: 0, failures: 0 }, 9)).toEqual({
      outcome: "dying", successes: 0, failures: 1,
    });
  });

  it("stabilises on the third success", () => {
    expect(resolveDeathSave({ successes: 2, failures: 1 }, 15)).toEqual({
      outcome: "stable", successes: 3, failures: 1,
    });
  });

  it("dies on the third failure", () => {
    expect(resolveDeathSave({ successes: 1, failures: 2 }, 5)).toEqual({
      outcome: "dead", successes: 1, failures: 3,
    });
  });

  it("caps a natural 1 at three failures", () => {
    expect(resolveDeathSave({ successes: 0, failures: 2 }, 1)).toEqual({
      outcome: "dead", successes: 0, failures: DEATH_SAVE_LIMIT,
    });
  });

  it("rejects impossible input", () => {
    expect(() => resolveDeathSave({ successes: 3, failures: 0 }, 12)).toThrow(DeathSaveInvariantError);
    expect(() => resolveDeathSave({ successes: 0, failures: -1 }, 12)).toThrow(DeathSaveInvariantError);
    expect(() => resolveDeathSave({ successes: 0, failures: 0 }, 0)).toThrow(RangeError);
    expect(() => resolveDeathSave({ successes: 0, failures: 0 }, 21)).toThrow(RangeError);
  });
});

describe("resolveDownedBlow", () => {
  it("kills when leftover damage equals max HP exactly", () => {
    expect(resolveDownedBlow({ hpBefore: 5, damage: 25, maxHp: 20 })).toBe("instant_death");
  });

  it("leaves the player dying one point short", () => {
    expect(resolveDownedBlow({ hpBefore: 5, damage: 24, maxHp: 20 })).toBe("dying");
  });
});

describe("stabilize and shouldWake", () => {
  it("schedules the wake round from the d4", () => {
    expect(stabilize(4, 3)).toBe(7);
    expect(() => stabilize(4, 5)).toThrow(RangeError);
    expect(() => stabilize(4, 0)).toThrow(RangeError);
  });

  it("wakes a stable player from the scheduled round on", () => {
    expect(shouldWake({ hp: 0, stableWakeRound: 7 }, 6)).toBe(false);
    expect(shouldWake({ hp: 0, stableWakeRound: 7 }, 7)).toBe(true);
    expect(shouldWake({ hp: 0, stableWakeRound: 7 }, 8)).toBe(true);
  });

  it("never wakes a dying or conscious player", () => {
    expect(shouldWake({ hp: 0, stableWakeRound: null }, 99)).toBe(false);
    expect(shouldWake({ hp: 0 }, 99)).toBe(false);
    expect(shouldWake({ hp: 1, stableWakeRound: null }, 99)).toBe(false);
  });
});

describe("derivePlayerLifeState", () => {
  it("derives every state from the persisted fields", () => {
    expect(derivePlayerLifeState({ hp: 5 })).toBe("conscious");
    expect(derivePlayerLifeState({ hp: 0, deathSaveFailures: 2, stableWakeRound: null })).toBe("dying");
    expect(derivePlayerLifeState({ hp: 0, deathSaveSuccesses: 3, stableWakeRound: 6 })).toBe("stable");
    expect(derivePlayerLifeState({ hp: 0, deathSaveFailures: 3 })).toBe("dead");
  });

  it("rejects a conscious player carrying death-save state", () => {
    expect(() => derivePlayerLifeState({ hp: 5, stableWakeRound: 3 })).toThrow(DeathSaveInvariantError);
    expect(() => derivePlayerLifeState({ hp: 5, deathSaveFailures: 1 })).toThrow(DeathSaveInvariantError);
  });
});
