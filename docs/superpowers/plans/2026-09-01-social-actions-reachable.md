# Social Actions Reachable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a social check something a player can actually cause, by giving the overlay a route to call and the roster a way to open it.

**Architecture:** A dedicated `POST /api/campaign/[id]/social` authenticates, checks ownership, establishes first contact when needed, and delegates the resolution to `social-service.resolveSocialCheck`, which already resolves, persists and returns facts inside a transaction. The NPC roster opens the overlay; the overlay calls the route and renders the returned facts. Two frame types that nothing ever emitted are retired.

**Tech Stack:** TypeScript, Next.js 15 App Router, Zod 4, Prisma 6, Vitest 4, React 19.

**Spec:** `docs/superpowers/specs/2026-09-01-social-actions-reachable-design.md`

## Global Constraints

- D&D 5e/SRD 2014 is the only active rules baseline.
- Backend code owns mechanical truth. The client sends intent; it never sends a roll, a DC, a disposition or an outcome.
- **No migration.** No column is added, removed, retyped or renamed.
- The route resolves through `social-service.resolveSocialCheck`. Do not write a second resolution path — that is how trade ended up with two.
- Mechanical facts only. **No narration** is generated or requested anywhere in this plan.
- Run tests with `pnpm exec vitest run <path> --maxWorkers=2`. **Never bare `pnpm test`** — it produces vitest worker-startup timeouts on this machine that read as failures. A test that *times out* is usually machine contention; re-run that file alone before concluding anything. A test that fails an *assertion* is not contention.
- `pnpm typecheck` green at the end of every task.
- Falsify every test: break the line it guards, confirm that specific test dies, restore.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/rules/social-service.ts` | Repair the phantom select and the dead ownership check |
| `app/api/campaign/[id]/social/route.ts` | New. Auth, ownership, first contact, delegation |
| `components/NPCRoster.tsx` | Rows open the overlay |
| `components/social/DialogueOverlayController.tsx` | Opens from the roster, calls the route, renders facts |
| `components/social/DialogueOverlay.tsx` | Renders the resolved check |
| `lib/events/game-events.ts` | Retire `dialogue_open` and `dialogue_update` |
| `app/campaign/[id]/ActionInput.tsx` | Drop the branch that fed the retired frame |
| `tests/rules/social-check-service-contract.test.ts` | A Prisma double that honours `select` |
| `tests/api/social-route.test.ts` | New. Route behaviour |

---

### Task 1: A Prisma double that honours `select`

**Files:**
- Modify: `tests/rules/social-check-service-contract.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: a test-local `makeSocialDb` helper whose `findUnique` returns only the fields named in `select`

This task adds no production code. It exists because the current fake `tx`
returns whatever it is asked for, which is exactly why a phantom field and a
dead ownership check have survived in this module. Task 2 cannot prove its own
fix without this first.

- [ ] **Step 1: Read the existing fixture**

Read `tests/rules/social-check-service-contract.test.ts` and find where it
builds the injected `tx` / `db` object. Note every test that relies on it.

- [ ] **Step 2: Write the failing test**

Add to that file:

```typescript
it("returns only the fields a caller selected", async () => {
  const db = makeSocialDb({
    campaign: { id: "camp_1", characterId: "char_1", userId: "user_1" },
    character: { id: "char_1", stats: { CHA: 14 }, level: 5, skillProficiencies: ["Persuasion"] },
    npc: { id: "npc_1", campaignId: "camp_1", seed: "innkeeper_1", name: "Greta", disposition: 8, hasMetPlayer: true },
  });

  const row = await db.character.findUnique({
    where: { id: "char_1" },
    select: { id: true, stats: true },
  });

  expect(row).toEqual({ id: "char_1", stats: { CHA: 14 } });
  expect(row).not.toHaveProperty("level");
});

it("refuses a select for a field the model does not have", async () => {
  const db = makeSocialDb({
    campaign: { id: "camp_1", characterId: "char_1", userId: "user_1" },
    character: { id: "char_1", stats: {}, level: 1, skillProficiencies: [] },
    npc: { id: "npc_1", campaignId: "camp_1", seed: "s", name: "n", disposition: 0, hasMetPlayer: true },
  });

  await expect(
    db.character.findUnique({
      where: { id: "char_1" },
      select: { id: true, campaignId: true },
    })
  ).rejects.toThrow(/Unknown field .*campaignId.* on model .*Character/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run tests/rules/social-check-service-contract.test.ts --maxWorkers=2`
Expected: FAIL — `makeSocialDb` is not defined.

- [ ] **Step 4: Write the helper**

Add to the same test file, above the describes:

```typescript
/**
 * A Prisma double that behaves like Prisma on the two points that matter:
 * it returns only what `select` named, and it refuses a field the model does
 * not have. The permissive fake it replaces returned whatever it was asked
 * for, which is how `campaignId` came to be selected from `Character` — a
 * model with no such scalar — and why the ownership check reading it has
 * never once fired.
 */
const CHARACTER_FIELDS = ["id", "stats", "level", "skillProficiencies"] as const;
const NPC_FIELDS = ["id", "campaignId", "seed", "name", "disposition", "hasMetPlayer"] as const;
const CAMPAIGN_FIELDS = ["id", "characterId", "userId", "status"] as const;

function project<T extends Record<string, unknown>>(
  model: string,
  row: T | null,
  known: readonly string[],
  select?: Record<string, boolean>
): Record<string, unknown> | null {
  if (!select) return row;
  for (const field of Object.keys(select)) {
    if (!known.includes(field)) {
      throw new Error(`Unknown field \`${field}\` for select statement on model \`${model}\`.`);
    }
  }
  if (row === null) return null;
  const out: Record<string, unknown> = {};
  for (const field of Object.keys(select)) {
    if (select[field]) out[field] = row[field as keyof T];
  }
  return out;
}

function makeSocialDb(rows: {
  campaign: Record<string, unknown> | null;
  character: Record<string, unknown> | null;
  npc: Record<string, unknown> | null;
}) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    campaign: {
      findUnique: async (args: { select?: Record<string, boolean> }) =>
        project("Campaign", rows.campaign, CAMPAIGN_FIELDS, args.select),
    },
    character: {
      findUnique: async (args: { select?: Record<string, boolean> }) =>
        project("Character", rows.character, CHARACTER_FIELDS, args.select),
    },
    nPC: {
      findUnique: async (args: { select?: Record<string, boolean> }) =>
        project("NPC", rows.npc, NPC_FIELDS, args.select),
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return { ...rows.npc, ...args.data };
      },
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run tests/rules/social-check-service-contract.test.ts --maxWorkers=2`
Expected: the two new tests PASS. **Other tests in this file are expected to fail now** — that is the point, and Task 2 fixes the code they are catching. Record which ones fail and their messages.

- [ ] **Step 6: Commit**

```bash
git add tests/rules/social-check-service-contract.test.ts
git commit -m "test(social): make the service's Prisma double honour select"
```

---

### Task 2: Repair the phantom select and the dead ownership check

**Files:**
- Modify: `lib/rules/social-service.ts:237` (the character ownership check)
- Modify: `lib/rules/social-service.ts:318` (the character select)
- Test: `tests/rules/social-check-service-contract.test.ts`

**Interfaces:**
- Consumes: `makeSocialDb` from Task 1
- Produces: `resolveSocialCheck` that runs against real Prisma

`Character` has no `campaignId` scalar — only a `campaigns Campaign[]`
relation. Selecting it throws against real Prisma, and the check reading it is
therefore a no-op that has never fired. The NPC check beside it is fine:
`NPC.campaignId` exists and is selected, so leave it alone.

- [ ] **Step 1: Write the failing test**

Add to `tests/rules/social-check-service-contract.test.ts`:

```typescript
it("rejects a character that does not belong to the campaign", async () => {
  const db = makeSocialDb({
    campaign: { id: "camp_1", characterId: "char_OTHER", userId: "user_1" },
    character: { id: "char_1", stats: { CHA: 10 }, level: 1, skillProficiencies: [] },
    npc: { id: "npc_1", campaignId: "camp_1", seed: "s", name: "n", disposition: 8, hasMetPlayer: true },
  });

  await expect(
    resolveSocialCheck({
      campaignId: "camp_1",
      characterId: "char_1",
      npcId: "npc_1",
      approach: "persuade",
      intent: "a room",
      db: db as never,
    })
  ).rejects.toMatchObject({ code: "CHARACTER_OWNERSHIP_MISMATCH" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/rules/social-check-service-contract.test.ts --maxWorkers=2`
Expected: FAIL — either the `Unknown field campaignId` throw from Task 1's double, or the check passing a character it should have rejected. Both prove the defect.

- [ ] **Step 3: Fix the select**

At `lib/rules/social-service.ts:318`, remove `campaignId: true`:

```typescript
    select: { id: true, stats: true, level: true, skillProficiencies: true },
```

- [ ] **Step 4: Fix the ownership check**

Replace the character half of the ownership assert. The campaign row already
carries `characterId`, which is the field that actually says which character
belongs to this campaign:

```typescript
  // `Character` has no campaignId scalar — only a campaigns relation — so the
  // earlier version of this check read `character.campaignId`, was always
  // undefined, and never once fired. `Campaign.characterId` is the field that
  // actually records the link, and this function already has the campaign row.
  if (campaign.characterId !== characterId) {
    throw new SocialServiceError(
      "CHARACTER_OWNERSHIP_MISMATCH",
      `Character ${characterId} does not belong to campaign ${campaignId}.`
    );
  }
```

Leave the NPC check on the following lines untouched.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/rules/social-check-service-contract.test.ts --maxWorkers=2` then `pnpm typecheck`
Expected: every test in the file passes, including the ones Task 1 broke.

- [ ] **Step 6: Falsify**

Delete the `if (campaign.characterId !== characterId)` block. Confirm the
ownership test from Step 1 fails and nothing else does. Restore.

- [ ] **Step 7: Commit**

```bash
git add lib/rules/social-service.ts tests/rules/social-check-service-contract.test.ts
git commit -m "fix(social): select a field Character has, and make the ownership check fire"
```

---

### Task 3: The social route

**Files:**
- Create: `app/api/campaign/[id]/social/route.ts`
- Create: `tests/api/social-route.test.ts`

**Interfaces:**
- Consumes: `resolveSocialCheck` (Task 2); `initialAttitudeFor(seed: string, role: NPCRole): NpcAttitude` and `INITIAL_DISPOSITION: Record<NpcAttitude, number>` from `@/lib/rules/social-logic`
- Produces: `POST /api/campaign/[id]/social` accepting `{ npcId, approach, intent }` and returning `ResolveSocialCheckResult` as JSON

Follow the shape of `app/api/campaign/[id]/npc/route.ts` for auth and
ownership — same order, same status codes.

**First contact.** The service throws `NPC_NOT_MET` when `hasMetPlayer` is
false. The roster lists every NPC, so the route establishes first contact
rather than rejecting: derive the opening attitude from the NPC's own seed and
role, seat the disposition, set `hasMetPlayer`, then resolve. `NPC.role` is a
string column; cast it to `NPCRole` when calling `initialAttitudeFor`.

- [ ] **Step 1: Write the failing test**

Create `tests/api/social-route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/campaign/[id]/social/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { resolveSocialCheck } from "@/lib/rules/social-service";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    nPC: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(),
  AuthError: class extends Error {},
}));

vi.mock("@/lib/rules/social-service", () => ({
  resolveSocialCheck: vi.fn(),
  SocialServiceError: class extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));

function request(body: unknown) {
  return new Request("http://test/api/campaign/camp_1/social", {
    method: "POST",
    body: JSON.stringify(body),
  }) as never;
}

const params = Promise.resolve({ id: "camp_1" });

beforeEach(() => {
  vi.clearAllMocks();
  (getAuthUser as never as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "user_1" });
  (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "user_1",
    status: "active",
  });
  (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "npc_1", campaignId: "camp_1", seed: "innkeeper_1", role: "commoner", hasMetPlayer: true,
  });
  (resolveSocialCheck as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true, approach: "persuade", skill: "Persuasion", roll: 12, dc: 15,
    success: false, attitudeBefore: "Indifferent", attitudeAfter: "Hostile",
    dispositionBefore: 0, dispositionAfter: -4,
  });
});

describe("POST /api/campaign/[id]/social", () => {
  it("resolves a social check for the campaign's owner", async () => {
    const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "a room" }), { params });

    expect(response.status).toBe(200);
    expect(resolveSocialCheck).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({ attitudeAfter: "Hostile" });
  });

  it("refuses a campaign belonging to another user", async () => {
    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "someone_else", status: "active",
    });

    const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "x" }), { params });

    expect(response.status).toBe(403);
    expect(resolveSocialCheck).not.toHaveBeenCalled();
  });

  it("refuses an inactive campaign", async () => {
    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "user_1", status: "completed",
    });

    const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "x" }), { params });

    expect(response.status).toBe(409);
    expect(resolveSocialCheck).not.toHaveBeenCalled();
  });

  it("refuses an unknown approach without resolving anything", async () => {
    const response = await POST(request({ npcId: "npc_1", approach: "seduce", intent: "x" }), { params });

    expect(response.status).toBe(400);
    expect(resolveSocialCheck).not.toHaveBeenCalled();
  });

  it("establishes first contact before resolving, for an NPC never met", async () => {
    (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "npc_1", campaignId: "camp_1", seed: "gate_guard_north", role: "guard", hasMetPlayer: false,
    });

    const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "x" }), { params });

    expect(response.status).toBe(200);
    expect(prisma.nPC.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "npc_1" },
        data: expect.objectContaining({ hasMetPlayer: true }),
      })
    );
  });

  it("does not re-establish contact for an NPC already met", async () => {
    await POST(request({ npcId: "npc_1", approach: "persuade", intent: "x" }), { params });

    expect(prisma.nPC.update).not.toHaveBeenCalled();
  });

  it("refuses an NPC from another campaign", async () => {
    (prisma.nPC.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "npc_1", campaignId: "camp_OTHER", seed: "s", role: "guard", hasMetPlayer: true,
    });

    const response = await POST(request({ npcId: "npc_1", approach: "persuade", intent: "x" }), { params });

    expect(response.status).toBe(404);
    expect(resolveSocialCheck).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/api/social-route.test.ts --maxWorkers=2`
Expected: FAIL — the route module does not exist.

- [ ] **Step 3: Write the route**

Create `app/api/campaign/[id]/social/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { resolveSocialCheck, SocialServiceError } from "@/lib/rules/social-service";
import { initialAttitudeFor, INITIAL_DISPOSITION } from "@/lib/rules/social-logic";
import type { NPCRole } from "@/lib/rules/npc";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const BodySchema = z
  .object({
    npcId: z.string().min(1).max(200),
    approach: z.enum(["persuade", "intimidate", "deceive"]),
    intent: z.string().max(200),
  })
  .strict();

/**
 * POST /api/campaign/[id]/social
 *
 * Resolves one attempt to talk an NPC round.
 *
 * The client sends who, which approach, and what it wants. It never sends a
 * roll, a DC or a disposition: those are the backend's, and `resolveSocialCheck`
 * settles them and persists the result in one transaction.
 *
 * First contact is established here rather than refused. The roster lists every
 * NPC, so a player can click one the party has never spoken to; the opening
 * attitude comes from that NPC's own seed, the same way the rest of them is
 * derived, and never from who happens to be doing the talking.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: campaignId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid social action." }, { status: 400 });
  }

  let user;
  try {
    user = await getAuthUser();
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { userId: true, status: true },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  if (campaign.userId !== user.id) {
    return NextResponse.json({ error: "Campaign does not belong to this user." }, { status: 403 });
  }
  if (campaign.status !== "active") {
    return NextResponse.json({ error: "Campaign is not active." }, { status: 409 });
  }

  const npc = await prisma.nPC.findUnique({
    where: { id: parsed.data.npcId },
    select: { id: true, campaignId: true, seed: true, role: true, hasMetPlayer: true },
  });
  if (!npc || npc.campaignId !== campaignId) {
    return NextResponse.json({ error: "NPC not found." }, { status: 404 });
  }

  if (!npc.hasMetPlayer) {
    const attitude = initialAttitudeFor(npc.seed, npc.role as NPCRole);
    await prisma.nPC.update({
      where: { id: npc.id },
      data: { disposition: INITIAL_DISPOSITION[attitude], hasMetPlayer: true },
    });
  }

  try {
    const result = await resolveSocialCheck({
      campaignId,
      npcId: npc.id,
      approach: parsed.data.approach,
      intent: parsed.data.intent,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof SocialServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/api/social-route.test.ts --maxWorkers=2` then `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Falsify**

Remove the `campaign.userId !== user.id` block; confirm only the
another-user test fails; restore. Then remove the `!npc.hasMetPlayer` block;
confirm only the first-contact test fails; restore. Then change the
`.strict()` body schema to a plain object; confirm the unknown-approach test
still fails correctly (the enum, not strictness, guards that one) and note in
your report which assertion actually died.

- [ ] **Step 6: Commit**

```bash
git add app/api/campaign/\[id\]/social/route.ts tests/api/social-route.test.ts
git commit -m "feat(social): add the route that resolves a social check"
```

---

### Task 4: The roster opens the overlay

**Files:**
- Modify: `components/NPCRoster.tsx`
- Modify: `components/social/DialogueOverlayController.tsx`
- Test: `tests/components/NPCRoster.test.tsx` if it exists; create it if not

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: a `dungeon-npc-selected` window event carrying `{ npcId, name, disposition, hasMetPlayer }`

The controller currently opens on `dungeon-dialogue-open`, a frame nobody
emits. It will open on the roster's event instead. Keep using a window
CustomEvent: the two components have no common parent that already holds this
state, and the codebase already wires cross-component signals this way
(`lib/events/action-transport.ts`).

- [ ] **Step 1: Write the failing test**

Create or extend `tests/components/NPCRoster.test.tsx`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import NPCRoster from "@/components/NPCRoster";

afterEach(cleanup);

const npc = {
  id: "npc_1", name: "Greta the Ironmonger", role: "commoner",
  race: "human", profession: "smith", alignment: "neutral",
  hp: 9, maxHp: 9, ac: 11, notes: "", abilityScores: null, traits: null,
  disposition: 5, hasMetPlayer: true,
};

describe("NPCRoster", () => {
  it("announces the NPC when its row is activated", () => {
    const listener = vi.fn();
    window.addEventListener("dungeon-npc-selected", listener);

    render(<NPCRoster npcs={[npc]} />);
    fireEvent.click(screen.getByRole("button", { name: /Greta the Ironmonger/ }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      npcId: "npc_1",
      name: "Greta the Ironmonger",
    });

    window.removeEventListener("dungeon-npc-selected", listener);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/components/NPCRoster.test.tsx --maxWorkers=2`
Expected: FAIL — no element with role `button` named for the NPC.

- [ ] **Step 3: Make the rows activate**

In `components/NPCRoster.tsx`, wrap each NPC row's content in a `<button type="button">` carrying an accessible name that includes the NPC's name, and give it:

```typescript
  onClick={() =>
    window.dispatchEvent(
      new CustomEvent("dungeon-npc-selected", {
        detail: {
          npcId: npc.id,
          name: npc.name,
          disposition: npc.disposition,
          hasMetPlayer: npc.hasMetPlayer,
        },
      })
    )
  }
```

Keep the existing attitude badge and colours inside the button — this task
changes what the row does, not what it shows.

- [ ] **Step 4: Point the controller at the new event**

In `components/social/DialogueOverlayController.tsx`, replace the
`dungeon-dialogue-open` listener with one for `dungeon-npc-selected`, mapping
its detail onto the state the overlay already expects. Remove the
`dungeon-dialogue-update` listener; Task 5 replaces it with the route's
response.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/components/ --maxWorkers=2` then `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Falsify**

Change the dispatched event name to `dungeon-npc-chosen`. Confirm the roster
test fails. Restore.

- [ ] **Step 7: Commit**

```bash
git add components/NPCRoster.tsx components/social/DialogueOverlayController.tsx tests/components/
git commit -m "feat(social): open the dialogue overlay from the NPC roster"
```

---

### Task 5: The overlay calls the route

**Files:**
- Modify: `components/social/DialogueOverlayController.tsx`
- Modify: `components/social/DialogueOverlay.tsx`
- Test: `tests/components/DialogueOverlayController.test.tsx` — create it

**Interfaces:**
- Consumes: the route from Task 3; the `dungeon-npc-selected` event from Task 4
- Produces: nothing later tasks rely on

The controller stops calling `requestDungeonAction` and calls the route. The
returned `dispositionAfter` updates the meter directly, so no event is needed
for it. The overlay renders the resolved facts; it generates no prose.

- [ ] **Step 1: Write the failing test**

Create `tests/components/DialogueOverlayController.test.tsx`:

```typescript
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import DialogueOverlayController from "@/components/social/DialogueOverlayController";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function openWith(npcId = "npc_1") {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("dungeon-npc-selected", {
        detail: { npcId, name: "Greta", disposition: 5, hasMetPlayer: true },
      })
    );
  });
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true, approach: "persuade", skill: "Persuasion", roll: 18, dc: 15,
      total: 20, success: true, attitudeBefore: "Friendly", attitudeAfter: "Friendly",
      dispositionBefore: 5, dispositionAfter: 9,
    }),
  } as Response);
});

describe("DialogueOverlayController", () => {
  it("stays closed until an NPC is selected", () => {
    render(<DialogueOverlayController campaignId="camp_1" characterId="char_1" />);
    expect(screen.queryByText(/Greta/)).toBeNull();
  });

  it("posts the social action to the campaign's social route", async () => {
    render(<DialogueOverlayController campaignId="camp_1" characterId="char_1" />);
    openWith();

    fireEvent.click(await screen.findByRole("button", { name: /persuade/i }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/campaign/camp_1/social");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      npcId: "npc_1",
      approach: "persuade",
    });
  });

  it("shows the resolved roll and the new disposition", async () => {
    render(<DialogueOverlayController campaignId="camp_1" characterId="char_1" />);
    openWith();

    fireEvent.click(await screen.findByRole("button", { name: /persuade/i }));

    expect(await screen.findByText(/18/)).toBeTruthy();
    expect(await screen.findByText(/DC 15/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/components/DialogueOverlayController.test.tsx --maxWorkers=2`
Expected: FAIL — the controller still dispatches through `requestDungeonAction` and no fetch occurs.

- [ ] **Step 3: Rewrite the controller's dispatch**

Replace `dispatchAction` and the four handlers so each posts to the route:

```typescript
  const [result, setResult] = useState<SocialCheckDisplay | null>(null);

  const resolveSocial = async (approach: "persuade" | "intimidate" | "deceive") => {
    if (!npc) return;
    setIsLoading(true);
    try {
      const response = await fetch(`/api/campaign/${campaignId}/social`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ npcId: npc.npcId, approach, intent: "" }),
      });
      if (!response.ok) return;
      const facts = await response.json();
      setResult(facts);
      setNpc((prev) => (prev ? { ...prev, disposition: facts.dispositionAfter } : prev));
    } finally {
      setIsLoading(false);
    }
  };
```

`campaignId` is already a prop and is currently unused — this is what it was
for. Pass `result` down to `DialogueOverlay`.

- [ ] **Step 4: Render the facts**

In `DialogueOverlay.tsx`, accept a `result` prop and render, when present, the
natural roll, the DC, whether it succeeded, and the attitude before and after.
No prose, no invented description.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/components/ --maxWorkers=2` then `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Falsify**

Change the posted URL to `/api/campaign/${campaignId}/socail`. Confirm the
route-URL test fails and the others still pass. Restore.

- [ ] **Step 7: Commit**

```bash
git add components/social/ tests/components/
git commit -m "feat(social): resolve social actions through the social route"
```

---

### Task 6: Retire the two frames nothing emits

**Files:**
- Modify: `lib/events/game-events.ts:162, 172`
- Modify: `app/campaign/[id]/ActionInput.tsx:173-176`
- Test: `tests/architecture/single-disposition-band.test.ts` — add a guard

**Interfaces:**
- Consumes: Tasks 4 and 5, which removed the last consumers
- Produces: nothing

`dialogue_open` was declared and consumed and never emitted — the orphan this
whole line of work traces back to. Now that the overlay opens from the roster,
delete it rather than leave a consumer with no producer.

- [ ] **Step 1: Write the failing test**

Add to `tests/architecture/single-disposition-band.test.ts`, reusing the
`SOURCES` constant already at the top of that file:

```typescript
describe("retired dialogue frames", () => {
  it("leaves no reference to a frame type nothing emits", () => {
    const survivors = SOURCES.filter(([, text]) =>
      /dialogue_open|dungeon-dialogue-open|dialogue_update|dungeon-dialogue-update/.test(text),
    ).map(([path]) => relative(path));

    expect(survivors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/architecture/single-disposition-band.test.ts --maxWorkers=2`
Expected: FAIL, listing `game-events.ts` and `ActionInput.tsx`.

- [ ] **Step 3: Delete the declarations and the consumer**

In `lib/events/game-events.ts`, remove the `dialogue_open` and
`dialogue_update` members of the frame union and the doc-comment lines
describing them. In `app/campaign/[id]/ActionInput.tsx`, remove the
`parsed.t === "dialogue_open"` branch and its `dispatchEvent`. If
`DialogueOpenPayload` becomes unreferenced, delete it too — check first.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/architecture/ tests/components/ --maxWorkers=2` then `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Falsify**

Re-add `| { t: "dialogue_open"; payload: unknown }` to the union. Confirm the
new guard fails. Restore.

- [ ] **Step 6: Commit**

```bash
git add lib/events/game-events.ts app/campaign/\[id\]/ActionInput.tsx tests/architecture/
git commit -m "refactor(events): retire the dialogue frames nothing ever emitted"
```

---

### Task 7: Prove the whole thing

**Files:**
- No production changes expected

- [ ] **Step 1: Run the full battery**

In order, with the real output in your report:
1. `pnpm typecheck`
2. `pnpm exec vitest run --maxWorkers=2` — the suite stood at **3465** before this plan
3. `pnpm lint`
4. `pnpm build` — this plan adds an API route, and `AGENTS.md` requires a build for route changes

If a test times out, re-run that file alone before concluding anything.

- [ ] **Step 2: Confirm nothing was left dangling**

Run:
```bash
grep -rn "dialogue_open\|dialogue_update\|requestDungeonAction" --include=*.ts --include=*.tsx app/ lib/ components/
```
Report every surviving hit with a verdict. `requestDungeonAction` legitimately
survives for non-social actions; the dialogue frames must not survive at all.

- [ ] **Step 3: Commit if anything changed**

```bash
git add -A
git commit -m "chore(social): close out the reachability increment"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| Decision 1 — dedicated route | 3 |
| Decision 2 — roster opens the overlay; frames retired | 4, 6 |
| Decision 3 — mechanical facts only | 5, step 4 |
| Blocking defect — phantom select | 2 |
| Blocking defect — dead ownership check | 2 |
| Prisma double honouring `select` | 1 |
| Guard proving ownership is not a no-op | 2, step 1 |
| Route tests: auth, ownership, active, malformed, happy path | 3 |
| Out of scope — narration, intent gate, rumours, natural-20 | absent, correctly |

One spec item is **not** covered because it was wrong: the spec says the NPC
ownership check is also worth reviewing. It is not — `findNpc` selects
`campaignId` in both branches and `NPC.campaignId` exists, so that check
works. Only the character half is dead. Task 2 says so explicitly and leaves
the NPC check alone.

**Decision added during planning, not in the spec:** first contact. The
service refuses an NPC with `hasMetPlayer: false`, and the roster lists every
NPC, so clicking an unmet one would have failed. Task 3 establishes contact
from the NPC's own seed. Approved by the maintainer before this plan was
written.

**Placeholder scan:** none.

**Type consistency:** `initialAttitudeFor(seed, role)`, `INITIAL_DISPOSITION`,
`resolveSocialCheck(input)` and `SocialServiceError.code` are used with the
signatures they actually have, read from source while writing this plan.

**Known risk:** Task 3's route test mocks `resolveSocialCheck`, so it proves
the route's gating, not the service's behaviour. Task 1 and 2's contract tests
carry that half. Neither exercises real Prisma — the first time this runs
against the real database is in the maintainer's hands, and `social-service`
has never done so before. Task 7's `pnpm build` is the closest available
proxy.
