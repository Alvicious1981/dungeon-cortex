# API Documentation — Dungeon Cortex

This document covers the main campaign action route and its streaming/retry contract. Other routes are not fully specified here.

Reviewed against the implementation on 2026-09-30. This is a static contract review; it does not claim that runtime or integration tests were executed.

## Authority and implementation

Backend code owns mechanical legality, rolls, DCs, HP, resources, conditions, persistence, and deterministic events. The frontend collects intent and renders authoritative state; narration describes resolved facts.

Relevant implementation:

- [Action route](../app/api/campaign/%5Bid%5D/action/route.ts)
- [Shared request transport](../lib/events/action-transport.ts)
- [Game events and SSE frames](../lib/events/game-events.ts)
- [Action receipts](../lib/actions/request-receipt.ts)
- [Roll command](../lib/actions/roll-command.ts)
- [Narrator](../lib/ai/narrator.ts)
- [Narrator tool policy](../lib/ai/tool-policy.ts)
- [Architecture guide](../MASTER_ARCH_GUIDE.md)

The current identity resolver is private mode, not real authentication: it requires literal `PRIVATE_MODE_ENABLED=true` and returns the same private user for every request. Ownership checks compare against that identity; they do not provide isolation between people sharing private mode.

## `POST /api/campaign/[id]/action`

Validates the request and campaign, resolves the applicable backend gates, persists the result, and responds with JSON for `/roll ` or SSE for normal narrative actions.

### Request body

| Field | Type | Required | Contract |
| --- | --- | --- | --- |
| `action` | string | Yes | Trimmed, non-empty player action or macro; length is bounded by `NARRATOR_DATA_LIMITS.playerActionChars`. |
| `requestId` | string | No, for legacy compatibility | If present: trimmed, non-empty, at most 128 characters. Enables durable deduplication. The application client always sends it. |
| `targetIds` | string array | No | Combatant IDs; each action validates its target selection. |
| `targetX` | integer | No | Zero-based footprint-anchor X for `Move`, from 0 through 9. |
| `targetY` | integer | No | Zero-based footprint-anchor Y for `Move`, from 0 through 9. |

Example for an existing campaign belonging to the current private user:

```json
{
  "action": "/roll 1d20+5",
  "requestId": "example-roll-001"
}
```

Use a fresh ID for each new action. Keep the same ID and mechanically relevant payload for a retry of that submission.

### Macro actions

The route has explicit branches for:

- `Attack`: exactly one selected target; requires the player's turn.
- `End Turn`: finalizes the player's turn, or resumes a chain parked on an enemy-owned slot.
- `Move`: backend-validated tactical movement.
- `Death Save`: available to a dying player.
- `Wait`: available to a stable unconscious player.

Availability depends on encounter and player state. These branches bypass natural-language classification. Natural-language classification in `lib/ai/intent.ts` is also deterministic; it does not make an LLM classification call. Recognized intents proceed to their backend gates; ambiguous mechanical input requests clarification rather than being narrated as a resolved outcome.

`Move` uses the top-left footprint anchor on the fixed 10×10 grid. The entire footprint must fit: a Large creature can anchor at `(8,8)`, but not `(9,8)`. An out-of-bounds destination returns HTTP 400 / `MOVE_OUT_OF_BOUNDS` before movement state, budget, canonical history, or movement events change.

### Non-streaming roll command

The command prefix is `/roll `, including its trailing space. `/roll` alone does not enter the roll handler.

For `/roll 1d20+5`, the handler:

1. Attempts to parse and roll the notation.
2. Persists the player command and a system line with the result.
3. Settles the receipt, when present.
4. Returns HTTP 202 with `{"ok":true}`.

Invalid notation also returns HTTP 202 with the same body and writes an invalid-notation warning to the chronicle. A 202 response does not establish that dice were successfully rolled. This handler emits no SSE or game events.

## Streaming contract

SSE frames are JSON following `data: `, terminated by a blank line. Network chunks need not align with frames; accumulate and parse complete frames.

Normal order:

1. Deterministic `evt` frames.
2. `level_up_available`, if the backend detects a pending level-up.
3. Verified narration in `txt`.
4. `done`, after which the client refreshes authoritative state.

| Discriminator `t` | Wire payload | Current behavior |
| --- | --- | --- |
| `evt` | `e: GameEvent` | Deterministic backend event. |
| `level_up_available` | `payload` | Notice of a pending level-up; no level-up is applied by this frame. |
| `txt` | `d: string` | Text chunk. The current narrator buffers and validates the complete response before yielding one verified chunk. |
| `duplicate` | `requestId: string` | Completed submission recognized; mechanics are not executed again. |
| `level_up` | `payload` | Retained contract branch; the current narrator payload resolves null, so that branch emits nothing. |
| `merchant` | `payload` | Retained contract branch; the current narrator payload resolves null, so that branch emits nothing. |
| `done` | None | End of stream. |

The narrator's four tools are read-only SRD lookups. No mutating tool callback is wired into the model-visible catalogue. Output validation can replace generated text with validated fallback prose.

Mechanical resolution and receipt completion precede narrative delivery. The route schedules assistant-log persistence and memory consolidation using `after(...)`; a completed receipt does not guarantee narration was delivered or persisted. Do not repeat a settled mechanical action merely to obtain missing prose.

## Deduplication and retries

`requestId` is scoped to the actor, with a unique database constraint on `(actorUserId, requestId)`. It is bound to the campaign and a fingerprint of the action, targets, and coordinates. Missing IDs skip the receipt protocol and have no durable deduplication protection.

| Existing receipt / conflict | Response |
| --- | --- |
| Pending (`PROCESSING`) | HTTP 409 / `ACTION_IN_FLIGHT`. The outcome is uncertain; a live and an interrupted submission are indistinguishable. |
| ID bound to another campaign or payload | HTTP 409 / `REQUEST_ID_REUSED`. |
| Completed JSON response, including a roll | Original status and body replayed; no second roll. |
| Rejected submission | Stored refusal status and body replayed. |
| Completed stream | HTTP 200 SSE: `duplicate`, stored `evt` frames when available, then `done`. No narration or stale level-up notice is replayed. |

Replay-event snapshots are best-effort and limited to 64 KiB. Old receipts or snapshots that could not be stored produce `duplicate` followed by `done` without events; refresh state in either case.

For `ACTION_IN_FLIGHT`, refresh and inspect state/history before diagnosing the unresolved receipt. Do not change the ID to force an uncertain action to run again. For a genuinely new action, generate a new ID.

## Errors and recovery

| Status / code | Meaning and recovery |
| --- | --- |
| 400 | Invalid JSON, action, target, movement, or other action-specific refusal. Correct the request. |
| 401 | Private identity is not enabled. Check the local private-mode configuration. |
| 403 | Campaign does not belong to the resolved user. |
| 404 | Campaign not found. |
| 409 / `CAMPAIGN_NOT_ACTIVE` | The campaign is inactive. |
| 409 / `CHARACTER_DEAD` | Persistent character death prevents further writes. |
| 409 / `PLAYER_UNCONSCIOUS` | Ordinary actions refused; the action route can identify `allowedAction` as `Death Save` or `Wait`. |
| 409 / `NOT_PLAYER_TURN` | Refresh turn state; ordinary player actions require the player's initiative slot. |
| 409 / `TURN_STATE_CONFLICT` | Concurrent turn state changed; the guarded transition rolls back. Refresh before declaring the next action. |
| 409 / `ACTION_IN_FLIGHT`, `REQUEST_ID_REUSED` | See retry semantics above. |
| 500 / `ENEMY_TURN_INVARIANT`, `DEATH_SAVE_INVARIANT` | Inconsistent combat state; the transition rolls back. Inspect server diagnostics. |

This table covers important responses, not every action-specific refusal.

### Retired turn endpoint

`POST /api/campaign/[id]/encounter/turn` returns HTTP 410. Send `{"action":"End Turn","requestId":"<new-id>"}` to the campaign action route instead.

## Combat consequence authority

`COMBAT_CONSEQUENCE.payload.targets[]` is the canonical consequence list. Each entry describes its target; `attackerIsPlayer` and `targetIsPlayer` explicitly identify player roles. The strict payload has no legacy flat consequence fields.

Do not infer emitted behavior from the event-type catalogue alone: some entries or compatibility frames can be declared without an active producer.

## Documentation maintenance

When requests, responses, retry semantics, or frames change, update this document alongside the route, shared transport, and relevant tests. Verify both producers and consumers. Record runtime validation separately from static source inspection.
