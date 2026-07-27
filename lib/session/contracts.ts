import { z } from "zod";

export const SessionStatusSchema = z.enum(["ACTIVE", "PAUSED", "COMPLETED"]);
export type SessionStatusName = z.infer<typeof SessionStatusSchema>;

export const SessionModeSchema = z.enum([
  "PREPARING",
  "NARRATIVE",
  "SOCIAL",
  "EXPLORATION",
  "COMBAT",
  "REST",
  "RESOLUTION",
  "PAUSED",
  "COMPLETED",
]);
export type SessionModeName = z.infer<typeof SessionModeSchema>;

const TRANSITIONS: Record<SessionModeName, ReadonlySet<SessionModeName>> = {
  PREPARING: new Set(["NARRATIVE", "EXPLORATION", "COMBAT", "REST", "RESOLUTION", "PAUSED", "COMPLETED"]),
  NARRATIVE: new Set(["SOCIAL", "EXPLORATION", "COMBAT", "REST", "RESOLUTION", "PAUSED", "COMPLETED"]),
  SOCIAL: new Set(["NARRATIVE", "EXPLORATION", "COMBAT", "RESOLUTION", "PAUSED", "COMPLETED"]),
  EXPLORATION: new Set(["NARRATIVE", "SOCIAL", "COMBAT", "REST", "RESOLUTION", "PAUSED", "COMPLETED"]),
  COMBAT: new Set(["RESOLUTION", "PAUSED", "COMPLETED"]),
  REST: new Set(["NARRATIVE", "EXPLORATION", "RESOLUTION", "PAUSED", "COMPLETED"]),
  RESOLUTION: new Set(["NARRATIVE", "EXPLORATION", "REST", "PAUSED", "COMPLETED"]),
  PAUSED: new Set(["NARRATIVE", "EXPLORATION", "COMBAT", "COMPLETED"]),
  COMPLETED: new Set(),
};

export class SessionTransitionError extends Error {
  constructor(
    public readonly from: SessionModeName,
    public readonly to: SessionModeName
  ) {
    super(`Invalid session transition: ${from} -> ${to}.`);
    this.name = "SessionTransitionError";
  }
}

export function assertSessionTransition(
  from: SessionModeName,
  to: SessionModeName
): void {
  if (from === to) return;
  if (!TRANSITIONS[from].has(to)) {
    throw new SessionTransitionError(from, to);
  }
}

export function deriveSessionMode(input: {
  hasActiveEncounter: boolean;
  actionType?: string;
}): SessionModeName {
  if (input.hasActiveEncounter) return "COMBAT";
  if (input.actionType === "rest") return "REST";
  if (["explore", "travel", "move"].includes(input.actionType ?? "")) {
    return "EXPLORATION";
  }
  return "NARRATIVE";
}
