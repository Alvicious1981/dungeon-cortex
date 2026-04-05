/**
 * lib/memory/store.ts
 *
 * Database write layer for semantic memory entries (Milestone G).
 *
 * Responsibility: persist a MemoryEntry record — text + embedding vector —
 * to PostgreSQL via pgvector.
 *
 * Why $executeRaw: the `embedding` column is typed as Unsupported("vector(1536)")
 * in the Prisma schema, which means Prisma's generated client has no typed
 * accessor for it. Raw SQL with a ::vector cast is required.
 *
 * SQL injection safety: `id`, `campaignId`, `content`, and `importance` are
 * all passed as positional parameters ($1–$4). The embedding is formatted as a
 * Postgres array literal string and cast via ::vector in the query template —
 * it is constructed entirely from the number[] returned by the embedding API
 * (no user-supplied string content reaches that interpolation).
 *
 * Architecture contract ("Code is Law"):
 *   - This module only writes. It never reads, validates rules, or narrates.
 *   - Callers must already have persisted the canonical state change before
 *     calling saveMemory. Memory records are derived context, not source truth.
 *   - Failures are logged and swallowed so a memory write never breaks the
 *     game loop. Memory is advisory; canonical state tables are authoritative.
 */

import { prisma } from "@/lib/db/prisma";
import { generateEmbedding } from "@/lib/memory/embeddings";
import { randomUUID } from "crypto";

/**
 * Persists a semantic memory entry for a campaign.
 *
 * Embeds `content`, then inserts a `MemoryEntry` row with the resulting
 * vector. Failures are caught and logged — callers are not interrupted.
 *
 * @param campaignId - The campaign this memory belongs to.
 * @param content    - Human-readable summary text (≤ ~400 chars recommended).
 * @param importance - Relative weight for recall ranking (default 1.0).
 */
export async function saveMemory(
  campaignId: string,
  content: string,
  importance = 1.0
): Promise<void> {
  try {
    const embedding = await generateEmbedding(content);

    // Format as a Postgres array literal: [0.1,0.2,...] cast to vector.
    // The number[] values come exclusively from the embedding API — no
    // user-supplied content is interpolated into this string.
    const vectorLiteral = "[" + embedding.join(",") + "]";

    await prisma.$executeRaw`
      INSERT INTO "MemoryEntry" ("id", "campaignId", "content", "embedding", "importance", "createdAt", "updatedAt")
      VALUES (
        ${randomUUID()},
        ${campaignId},
        ${content},
        ${vectorLiteral}::vector,
        ${importance},
        NOW(),
        NOW()
      )
    `;
  } catch (err) {
    // Memory writes must never surface to the player. Log and continue.
    console.error("[saveMemory] Failed to persist memory entry:", err);
  }
}
