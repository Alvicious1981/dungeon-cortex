import { describe, expect, it } from "vitest";
import {
  assertSessionTransition,
  deriveSessionMode,
  SessionTransitionError,
} from "@/lib/session/contracts";

describe("full-session state contract", () => {
  it("supports preparation through play, pause, resume, resolution, and completion", () => {
    expect(() => assertSessionTransition("PREPARING", "NARRATIVE")).not.toThrow();
    expect(() => assertSessionTransition("NARRATIVE", "EXPLORATION")).not.toThrow();
    expect(() => assertSessionTransition("EXPLORATION", "COMBAT")).not.toThrow();
    expect(() => assertSessionTransition("COMBAT", "PAUSED")).not.toThrow();
    expect(() => assertSessionTransition("PAUSED", "COMBAT")).not.toThrow();
    expect(() => assertSessionTransition("COMBAT", "RESOLUTION")).not.toThrow();
    expect(() => assertSessionTransition("RESOLUTION", "COMPLETED")).not.toThrow();
  });

  it("blocks rest directly from combat and all transitions out of completion", () => {
    expect(() => assertSessionTransition("COMBAT", "REST")).toThrow(SessionTransitionError);
    expect(() => assertSessionTransition("COMPLETED", "NARRATIVE")).toThrow(SessionTransitionError);
  });

  it("derives authoritative modes from backend state", () => {
    expect(deriveSessionMode({ hasActiveEncounter: true, actionType: "rest" })).toBe("COMBAT");
    expect(deriveSessionMode({ hasActiveEncounter: false, actionType: "rest" })).toBe("REST");
    expect(deriveSessionMode({ hasActiveEncounter: false, actionType: "explore" })).toBe("EXPLORATION");
    expect(deriveSessionMode({ hasActiveEncounter: false, actionType: "general" })).toBe("NARRATIVE");
  });
});
