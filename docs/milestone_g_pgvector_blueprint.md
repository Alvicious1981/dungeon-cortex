# Milestone G — pgvector Semantic Memory Blueprint

**Status:** Planning
**Author:** Claude Code analysis, 2026-04-04
**Depends on:** Milestone D (memory / continuity — partial), Milestone F (production hardening)

---

## 1. Current Architecture — Honest Assessment

### 1.1 What exists today

| Layer | File | Status |
|-------|------|--------|
| Context assembly | `lib/memory/context.ts` | Implemented — fetches character, encounter, last 5 logs |
| Prompt formatting | `lib/memory/formatter.ts` | Implemented — pure, deterministic, well-structured |
| Narration pipeline | `lib/ai/narrator.ts` | Implemented — calls `gpt-4o-mini` with Vercel AI SDK tools |
| Intent parsing | `lib/ai/intent.ts` | Implemented — `generateObject` with strict Zod schema |
| World generation tools | `lib/rules/generators.ts`, `lib/rules/npc.ts` | Implemented — fully deterministic, seed-based |
| Prisma schema | `prisma/schema.prisma` | Implemented — no `MemoryEntry` or vector column yet |
| Memory retrieval | `lib/memory/` | **Missing** — no semantic search, no embedding store |

### 1.2 AI tool calling — current shape

`narrator.ts` exposes three tools to the LLM via Vercel AI SDK's `tool()` helper:

| Tool | Trigger | Backend | Returns |
|------|---------|---------|---------|
| `getTavernName` | Location flavour | `generateTavernName(locationId)` | Deterministic string |
| `getMundaneLoot` | Loot description | `generateMundaneLoot(entityId)` | Deterministic string |
| `getNPCDetails` | NPC interaction | `generateNPC(seed, role)` | `NPCStatblock` object |

**`stopWhen: stepCountIs(3)`** bounds the agentic loop at 3 steps — adequate for the current shallow toolset but may be too low once retrieval tools are added (each memory lookup is one step).

### 1.3 Context injection — current shape

`buildCampaignContext` assembles three hard-coded pillars in parallel:
1. Character + inventory
2. Active encounter + combatants
3. Last **5** `GameLog` rows (hard ceiling)

`formatSystemPrompt` then renders them as Markdown sections prepended to every LLM call. This is stateless and correct — no hidden mutations.

---

## 2. Gap Analysis

### 2.1 Missing Zod validations in narrator.ts tools

| Tool | Problem |
|------|---------|
| `getTavernName` | `locationId` accepts any string including empty string `""`. `generateTavernName("")` produces a deterministic but semantically meaningless name. Should validate `z.string().min(1)`. |
| `getMundaneLoot` | `entityId` has the same gap — empty string produces valid-looking but anchored-to-empty output. Add `.min(1)`. |
| `getNPCDetails` | `seed` description is good. `role` enum is correct. However the return value (`NPCStatblock`) is an object containing `hp` and `attackString` — the LLM may misread `attackString: "1d6+2"` as a final resolved number. A `description` hint to clarify this is a dice notation string, not a pre-rolled result, would reduce misuse. |

### 2.2 Error-handling gaps

| Location | Gap |
|----------|-----|
| `buildCampaignContext` | Throws a raw `Error` when the campaign is not found. The caller (`narrator.ts`) does not catch this. An HTTP 500 reaches the client with a raw stack trace. The action API route must wrap this in a structured error response. |
| `generateNarrative` | No timeout guard on the `generateText` call. A slow or hung OpenAI request blocks the server worker indefinitely. |
| `generateNarrative` | No fallback when the LLM returns an empty `text`. Downstream callers would persist an empty `GameLog` entry. |
| `parseIntent` | `generateObject` can throw if the model returns malformed JSON or a schema violation. No retry or fallback to `{ actionType: "general" }`. |
| NPC tool execute | `generateNPC` can theoretically throw `RangeError` from `pickSeeded` if a name table is empty — extremely unlikely in practice but unguarded at the tool boundary. |

### 2.3 Context-bloat risks

| Risk | Current state | Threshold concern |
|------|--------------|-------------------|
| Log window | Hard-coded at 5 entries | Safe today. As campaigns grow long, 5 is very shallow; semantically irrelevant recent logs displace useful distant context. pgvector retrieval is the correct fix. |
| Inventory dump | All items emitted unconditionally | A character with 30+ items will bloat the prompt significantly. Filtering to "relevant" items (e.g. equipped, consumable) is a near-term need. |
| Combatant list | All combatants emitted | Fine for standard encounters (≤10 combatants). Large battles (20+) could overflow. |
| No summarisation | Raw log content is truncated at 200 chars but never summarised | Long campaigns will rely on a thin, low-signal 5-entry window with no recall of earlier critical events. |

---

## 3. Milestone G — pgvector Semantic Memory Blueprint

### 3.1 Goal

Introduce a **semantic memory layer** backed by `pgvector` that enables:
- Recall of past events beyond the 5-log window
- Lore retrieval (world facts, NPC history, location descriptions)
- High-signal context injection: only the most relevant memories reach the prompt

This must remain strictly consistent with **"Code is Law"** and **"State is Truth"**: the retrieval layer is read-only and advisory. It never owns canonical state. Canonical state remains in the existing Prisma tables.

### 3.2 Architectural constraints (non-negotiable)

1. **pgvector is additive, not a replacement.** The existing `GameLog`, `Character`, `Campaign`, and `Encounter` tables remain the canonical state store. Memory records are derived from those tables, not the other way around.
2. **The AI does not write memory records.** The application server creates `MemoryEntry` rows after consequential state mutations, not in response to LLM output.
3. **Retrieval is deterministic at the query level.** Given the same query embedding and the same database state, cosine similarity ranking is stable. No non-determinism is introduced.
4. **Memory retrieval never overrides canonical state.** If a memory says "the player killed the Dragon King" but `Encounter` shows no resolved encounter, the canonical table wins.

### 3.3 New Prisma schema additions

```prisma
// Enable pgvector extension (run once via migration)
// CREATE EXTENSION IF NOT EXISTS vector;

model MemoryEntry {
  id          String   @id @default(cuid())
  campaignId  String
  /// "event" | "lore" | "npc" | "location" | "quest"
  type        String
  /// Human-readable summary stored for prompt injection.
  /// Max ~400 chars — enough for one memory "fragment".
  summary     String
  /// Source reference: "gamelog:<id>", "encounter:<id>", "manual"
  source      String
  /// The embedding vector — 1536 dims for text-embedding-3-small.
  /// Stored as Unsupported until Prisma ships native vector support.
  embedding   Unsupported("vector(1536)")
  importance  Float    @default(1.0)
  /// Soft delete / archive flag. Never hard-delete memory records.
  archived    Boolean  @default(false)
  createdAt   DateTime @default(now())

  campaign    Campaign @relation(fields: [campaignId], references: [id])

  @@index([campaignId])
  @@index([type])
}

// Add to Campaign model:
// memories  MemoryEntry[]
```

**Why `Unsupported("vector(1536)")`:** Prisma does not yet have a native `Vector` scalar. Using `Unsupported` allows schema management while raw SQL handles the vector column DDL and queries.

**Dimension choice — 1536:** Matches OpenAI `text-embedding-3-small` output. If the provider changes, run a migration to alter the column dimension and re-embed existing records. `text-embedding-3-small` is the cost/quality sweet spot for this use case.

### 3.4 New file structure

```
lib/memory/
├── context.ts          (existing — fetch canonical state)
├── formatter.ts        (existing — format system prompt)
├── embeddings.ts       (NEW — embed text, query vector store)
├── recall.ts           (NEW — retrieve relevant memories for a campaign)
└── writer.ts           (NEW — create MemoryEntry records from game events)
```

### 3.5 `lib/memory/embeddings.ts` — specification

**Responsibility:** Pure I/O wrapper around the OpenAI Embeddings API. No game-logic.

```typescript
// Conceptual interface only — not implementation code

interface EmbedResult {
  vector: number[];   // length 1536
  model: string;      // "text-embedding-3-small"
  tokensUsed: number;
}

async function embedText(text: string): Promise<EmbedResult>
```

**Constraints:**
- Call `openai.embeddings.create` with `model: "text-embedding-3-small"`.
- Input must be validated non-empty before the API call.
- Wrap API errors in a typed `EmbeddingError` — never let raw SDK errors surface.
- No caching in this layer (caller decides whether to persist).

### 3.6 `lib/memory/recall.ts` — specification

**Responsibility:** Given a query string and a campaign ID, return the top-K most semantically relevant `MemoryEntry` summaries for prompt injection.

```typescript
// Conceptual interface only — not implementation code

interface RecallOptions {
  campaignId: string;
  query: string;
  limit?: number;       // default: 5
  types?: string[];     // filter by memory type, e.g. ["event", "lore"]
  minImportance?: number; // default: 0.0 — no floor
}

interface RecalledMemory {
  id: string;
  type: string;
  summary: string;
  similarity: number;  // cosine similarity score, 0–1
}

async function recallMemories(options: RecallOptions): Promise<RecalledMemory[]>
```

**SQL pattern (raw Prisma `$queryRaw`):**

```sql
SELECT id, type, summary,
       1 - (embedding <=> $1::vector) AS similarity
FROM   "MemoryEntry"
WHERE  "campaignId" = $2
  AND  archived = false
  AND  ($3::text[] IS NULL OR type = ANY($3))
  AND  importance >= $4
ORDER  BY embedding <=> $1::vector
LIMIT  $5;
```

**Constraints:**
- The query embedding is computed fresh on each call via `embedText`.
- Results are ordered by cosine distance (`<=>` operator from pgvector).
- The function is **read-only** — no writes, no side effects.
- Return an empty array (not an error) when no memories match.
- The similarity threshold is left to the caller, not hard-coded here.

### 3.7 `lib/memory/writer.ts` — specification

**Responsibility:** Create `MemoryEntry` rows as a side-effect of confirmed state mutations. Called by the action route handler **after** state has been persisted — never inside the AI call.

```typescript
// Conceptual interface only — not implementation code

interface MemoryWriteInput {
  campaignId: string;
  type: "event" | "lore" | "npc" | "location" | "quest";
  summary: string;     // pre-written by caller, not generated by AI
  source: string;      // e.g. "gamelog:clxyz123" or "encounter:clxyz456"
  importance?: number; // default 1.0; bump for boss kills, quest completions
}

async function writeMemory(input: MemoryWriteInput): Promise<void>
```

**Constraints:**
- Computes the embedding for `summary` and writes the record atomically.
- **Never** accepts the LLM's output as the `summary` — the caller is responsible for producing a deterministic, factual summary from resolved game state.
- Fails silently (logs error, does not throw) so a memory write failure never breaks the game loop. Memory is advisory, not canonical.
- Deduplication: before inserting, check for a recent matching `source`. If the same source already has a memory entry with `archived = false`, skip the insert. (Prevents double-recording on retries.)

### 3.8 Context injection integration

`buildCampaignContext` grows a fourth pillar — **retrieved memories**:

```typescript
// Addition to CampaignContext (conceptual)
interface CampaignContext {
  character: ContextCharacter;
  activeEncounter: ContextEncounter | null;
  recentLogs: ContextLog[];
  relevantMemories: RecalledMemory[];  // NEW — up to 5, empty if unavailable
}
```

`formatSystemPrompt` gains a new section rendered **between** Recent Events and the closing context:

```markdown
## Memory Recall
*(Semantically relevant past events — treat as true but not exhaustive.)*
- [event] The party defeated the Bandit Captain "Harlan Vane" in the Thornwood Inn.
- [lore] The Iron Gate district is controlled by the Merchants' Consortium.
- [npc] Guard "Aldric Fenwick" was bribed and may be hostile if encountered again.
```

**Critical guardrail in prompt wording:** The injected header must explicitly state these are retrieved summaries, not the full canonical log. This prevents the model from treating missing memories as "events that never happened."

### 3.9 New AI tool: `recallLore`

Add one tool to `narrator.ts` for **on-demand semantic lookup** during narration — e.g. when the player asks "what do I know about the Thornwood?"

```typescript
// Tool definition addition to narrator.ts (conceptual)
recallLore: tool({
  description:
    "Search the campaign's memory store for lore, past events, or NPC history relevant to a topic. Use this before narrating details about places, factions, or named NPCs the player has encountered.",
  inputSchema: z.object({
    query: z.string().min(1).max(200).describe(
      "A short, specific topic to recall, e.g. 'Thornwood Inn', 'Merchants Consortium', 'Harlan Vane'"
    ),
    types: z.array(z.enum(["event", "lore", "npc", "location", "quest"])).optional(),
  }),
  execute: async ({ query, types }) =>
    recallMemories({ campaignId, query, types, limit: 3 }),
})
```

**Step count:** Increase `stopWhen: stepCountIs(3)` to `stepCountIs(5)` to allow for one proactive recall + one on-demand recall + narration step with headroom.

### 3.10 Migration plan

| Step | Action | Risk |
|------|--------|------|
| 1 | Add `CREATE EXTENSION IF NOT EXISTS vector;` as a raw SQL migration | Low — idempotent |
| 2 | Add `MemoryEntry` model to `schema.prisma` with `Unsupported("vector(1536)")` | Low |
| 3 | Run `pnpm prisma migrate dev` — generates table + indexes | Low |
| 4 | Create `lib/memory/embeddings.ts` with full error handling | Low |
| 5 | Create `lib/memory/recall.ts` using `$queryRaw` | Medium — raw SQL, test thoroughly |
| 6 | Create `lib/memory/writer.ts` | Low |
| 7 | Extend `CampaignContext` and `buildCampaignContext` with optional recall | Medium — must not break existing context assembly |
| 8 | Extend `formatSystemPrompt` with Memory Recall section | Low |
| 9 | Wire `writeMemory` into the action route after confirmed state mutations | Medium — sequence matters |
| 10 | Add `recallLore` tool to `narrator.ts`, bump step count | Low |
| 11 | Run `pnpm typecheck` after every file change | Required by CLAUDE.md |

### 3.11 Index strategy

```sql
-- IVFFlat index — appropriate for <1M rows
-- lists = sqrt(row_count) is standard starting point; use 50 for early campaigns
CREATE INDEX ON "MemoryEntry" USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 50);

-- Compound filter indexes for common WHERE clauses
CREATE INDEX ON "MemoryEntry" ("campaignId", archived);
CREATE INDEX ON "MemoryEntry" ("campaignId", type);
```

**When to switch to HNSW:** At >100K memory entries per deployment (far beyond near-term scope). IVFFlat is simpler to tune and sufficient for single-player campaigns.

### 3.12 Environment additions

```bash
# .env.example additions
OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
MEMORY_RECALL_LIMIT=5
MEMORY_MIN_IMPORTANCE=0.0
```

### 3.13 Open questions to surface before implementation

These must be answered by the user before Milestone G begins:

1. **Embedding provider:** Is OpenAI `text-embedding-3-small` the approved provider, or should this be model-agnostic (swappable via env var)?
2. **Memory creation trigger:** Which game events automatically create `MemoryEntry` records? Proposed minimum set: encounter resolved, NPC named + interacted with, quest status changed, player explicitly notes something ("remember that..."). Confirm scope.
3. **Importance scoring:** Is manual importance scoring sufficient, or should a lightweight classifier determine importance automatically?
4. **Backfill:** Should existing `GameLog` rows be backfilled into `MemoryEntry` on migration, or does memory start fresh from Milestone G onward?
5. **Cost envelope:** Each `recallLore` tool invocation costs one embedding API call. Acceptable, or should recall be pre-computed at session start only?
6. **pgvector availability on target host:** Confirm the PostgreSQL host supports the `vector` extension (Supabase, Neon, Railway all do; vanilla RDS requires manual install).

---

## 4. Summary

**Current state:** The context assembly and prompt formatting pipeline is clean, pure, and correct. The AI tool calling layer (3 tools) is functional but has minor input validation gaps. The critical missing piece is any form of semantic memory — the system currently has no recall beyond 5 raw log entries, no lore store, and no NPC continuity beyond seed-based reconstruction.

**Milestone G adds:** A `pgvector`-backed `MemoryEntry` table, an embedding layer, a read-only recall function, a server-side memory writer (triggered by state mutations, never by AI output), and one new `recallLore` tool — all structured to enforce the "Code is Law / State is Truth" invariants that define this project.

**What this is not:** A replacement for the canonical state tables. Memory is advisory context, never canonical truth.
