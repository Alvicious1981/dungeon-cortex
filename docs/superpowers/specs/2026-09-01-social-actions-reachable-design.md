# Social actions — making the mechanic reachable

Date: 2026-09-01
Status: Approved for planning. **Blocked on PR #99 merging** — this builds on the three-attitude model that lands there.

## Why

PR #99 makes the social check conform to the SRD. It is still unreachable: no
player action can cause one. `DialogueOverlayController` renders `null`
forever, because the `dialogue_open` frame it waits on is declared in
`lib/events/game-events.ts` and emitted by nobody.

This increment makes it reachable, and nothing more.

## Decisions

Three, taken during design. Each closed a fork that would have changed the
shape of the work.

### 1. A dedicated route, not an intent and a gate

`POST /api/campaign/[id]/social` takes `{ npcId, approach, intent }`.

The alternative was the pattern used for attacks and spells: a value in
`IntentSchema.actionType` plus a gate in the action route. It was rejected on
evidence. The overlay dispatches free text through `requestDungeonAction`, and
one of its four phrasings carries no NPC name at all —
`handleSpeak` sends `"the words" (I am trying to persuade them)`. Resolving a
free-text name to a row cannot work for that case, and the overlay is holding
the `npcId` the whole time and discarding it.

A dedicated route is also the established pattern here: `/magic/cast`,
`/rest`, `/level-up` and `/npc` all exist alongside the action route, which
handles typed prose.

**Consequence, accepted:** typing "I persuade the guard" into the main input
will do nothing. Adding the intent and gate later is additive.

### 2. The overlay opens from the NPC roster

`NPCRoster` is already live on the campaign screen and already receives `id`,
`name`, `disposition` and `hasMetPlayer` for each NPC. Its rows become
clickable and open the overlay for that NPC.

This is entirely client-side. **`dialogue_open` is retired** rather than left
declared with no producer — that orphan is what this whole line of work came
from, and leaving it would be leaving the defect while fixing its symptom.
`dialogue_update` goes too: the new disposition returns in the POST response,
so the controller sets state directly instead of waiting on a window event.

### 3. Mechanical facts only, no narration

The overlay shows the roll, the DC, success or failure, and the attitude
movement. No prose.

Narration through a plain POST would mean either a second round trip or
duplicating the action route's streaming machinery. Both are their own
increment, and the project's own order is backend first, narration after.

## The blocking defect

`social-service.resolveSocialCheck` already does what the route needs —
resolves the pure rule, persists `disposition`, returns facts, all inside a
transaction. The route should call it rather than write a second
implementation, which is how trade ended up with two.

**It does not currently work against real Prisma.** Its character lookup
selects `campaignId`:

```ts
select: { id: true, campaignId: true, stats: true, level: true, skillProficiencies: true }
```

`Character` has no `campaignId` scalar — only the `campaigns Campaign[]`
relation. Real Prisma throws `Unknown field campaignId` on the first call.

There is a second layer. Lines 237 and 246 read that field to check ownership:

```ts
if (character.campaignId && character.campaignId !== campaignId) throw …
if (npc.campaignId && npc.campaignId !== campaignId) throw …
```

Against real rows `character.campaignId` is always `undefined`, so **that
guard has never checked anything.** The NPC one is different: `NPC.campaignId`
does exist in the schema, so that check works if the field is selected.

This survives a green suite because `resolveDb` casts Prisma through a
hand-written interface and the contract test injects a fake `tx` that returns
whatever it is asked for. It is the same defect as `trade-service`'s phantom
`campaignId` on `InventoryItem`, recorded in `AGENTS.md`, in a second module.

**Repairing it is part of this increment**, because the route cannot work
otherwise: drop `campaignId` from the character select, and rewrite the
character ownership check against data that exists — `Campaign.characterId`,
which the same function already reads.

## Scope

| Area | Change |
| --- | --- |
| `lib/rules/social-service.ts` | Remove the phantom select; rewrite the character ownership check against `Campaign.characterId` |
| `app/api/campaign/[id]/social/route.ts` | New. Auth, ownership, active-campaign check, Zod body, delegate to `resolveSocialCheck` |
| `components/NPCRoster.tsx` | Rows become clickable, opening the overlay for that NPC |
| `components/social/DialogueOverlayController.tsx` | Opens from the roster; calls the new route; updates from its response |
| `lib/events/game-events.ts` | Retire `dialogue_open` and `dialogue_update` |
| `app/campaign/[id]/ActionInput.tsx` | Remove the `dialogue_open` branch that fed the retired frame |

## Testing

Route tests follow the shape of the existing route tests: unauthenticated is
rejected, another user's campaign is rejected, an inactive campaign is
rejected, a malformed body is rejected, and the happy path persists the new
disposition.

Two carry the weight:

**A Prisma double that honours `select`.** The current contract test's fake
`tx` returns whatever it is asked for, which is precisely why a phantom field
and two dead guards survived. The double must return `undefined` for fields
that were not selected, so a test can fail when the code asks for something it
did not select.

**A guard proving the ownership checks are not no-ops.** An NPC belonging to
another campaign must be rejected, and the test must fail if the assert is
removed. The check being rewritten has never once fired.

## Out of scope

- Narration for social actions
- A social intent type and action-route gate
- Rumours, which stay on the five-band model
- `resolveAbilityCheck`'s natural-20 auto-success, which governs every check in
  the game and is its own increment

## Risk

`social-service` will run against real Prisma for the first time. Its contract
test has only ever exercised a permissive fake. The phantom `campaignId` is
one known mismatch; the plan's first task should re-read every Prisma call in
that module against `schema.prisma` before trusting any of them.
