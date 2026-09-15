/**
 * The encounter turn changed under the transaction. Thrown whenever writes have
 * already happened, so the whole transaction rolls back; the action route maps
 * it to HTTP 409 TURN_STATE_CONFLICT. Shared by the route and the enemy-turn
 * chain (docs/superpowers/specs/2026-09-15-enemy-turns-design.md §8).
 */
export class TurnStateConflictError extends Error {
  constructor() {
    super("The encounter turn changed before the action could commit.");
    this.name = "TurnStateConflictError";
  }
}
