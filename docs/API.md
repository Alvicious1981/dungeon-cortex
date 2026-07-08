# API Documentation — Dungeon Cortex

This document summarizes the main API surface for contributors and Codex.

## API principles

- API routes validate input, permissions, and campaign state.
- Backend code owns mechanical legality, rolls, DCs, HP, spell slots, conditions, persistence, and deterministic events.
- AI narration must only describe outcomes already resolved by backend facts.
- The frontend renders state and collects intent; it does not resolve authoritative mechanics.

## Related implementation files

- `app/api/campaign/[id]/action/route.ts`
- `lib/events/game-events.ts`
- `lib/rules/combat-pipeline.ts`
- `lib/narrative/combat-fact-adapter.ts`
- `MASTER_ARCH_GUIDE.md`

## Documented vs undocumented routes

This document currently covers the main campaign action route only.

Additional API routes should be added here when their contracts become stable. If a route changes request fields, response shape, SSE frames, or error semantics, update this document in the same PR.

## Streaming contract

The main action route emits Server-Sent Events.

General stream phases:

1. Deterministic game events.
2. AI narration tokens.
3. Optional payloads such as level-up or merchant data.
4. Completion sentinel.

Frame categories:

| Frame kind | Purpose |
| --- | --- |
| `evt` | Backend-resolved deterministic game event. |
| `txt` | Narration text delta. |
| `level_up` | Optional level-up payload. |
| `merchant` | Optional merchant payload. |
| `done` | Stream completion marker. |

Pseudo-flow:

```text
backend event frame
narration text frame
optional payload frame
completion frame
```

## `POST /api/campaign/[id]/action`

Handles player actions, deterministic gates, state mutation, game events, and narration streaming.

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | string | Yes | Player action or macro action. |
| `targetIds` | string array | No | Combatant IDs for targeted actions. |
| `targetX` | number | No | Tactical grid destination X for movement. |
| `targetY` | number | No | Tactical grid destination Y for movement. |

### Macro actions

The route supports deterministic macro actions that bypass LLM intent parsing for reliability:

- `Attack`
- `End Turn`
- `Move`

### Non-streaming action exception

`/roll` commands are handled as a quick non-streaming response.

Example user action:

```text
/roll 1d20+5
```

Expected behavior:

- validate dice notation;
- persist the user action;
- persist the system roll result;
- return a JSON status response.

### Natural language actions

Natural language actions are parsed into intent before backend resolution.

Known intent categories include:

- attack,
- cast spell,
- use item,
- equip,
- rest,
- explore,
- travel,
- move.

### Error responses

| Status | Meaning |
| --- | --- |
| `400` | Invalid JSON, missing action, invalid target, invalid movement, or action impossible. |
| `401` | Authentication failure. |
| `403` | Campaign does not belong to the authenticated user. |
| `404` | Campaign not found. |
| `409` | Campaign is not active. |

## Event authority

A game event is authoritative only when emitted by backend code.

Important event categories:

- combat consequence events,
- turn and round advancement,
- movement events,
- equipment events,
- rest events,
- exploration warnings,
- level-up and merchant payloads.

## Combat consequence rule

`targets[]` is the canonical source of truth for combat consequences.

Deprecated flat fields such as `targetId`, `hpAfter`, or `damage` must not be used as the primary source of truth in new code.

## Documentation maintenance

When an API route changes, update this document in the same PR.

When event payloads change, also check:

- `lib/events/game-events.ts`
- `MASTER_ARCH_GUIDE.md`
- related tests
