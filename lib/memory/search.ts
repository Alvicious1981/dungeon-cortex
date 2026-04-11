/**
 * lib/memory/search.ts
 *
 * Read-layer for semantic memory retrieval (Milestone G).
 *
 * Responsibility: given a natural-language query, return the most relevant
 * MemoryEntry summaries for a campaign using pgvector cosine similarity.
 *
 * Why $queryRaw: the `embedding` column is Unsupported("vector(1536)") in the
 * Prisma schema, so the generated client has no typed accessor for it. The
 * cosine distance operator (<=>) is also pgvector-specific and not expressible
 * in Prisma's query builder.
 *
 * SQL injection safety: `campaignId` and `limit` are bound as positional
 * parameters via Prisma's tagged template. The vector literal is built
 * exclusively from the number[] returned by the embedding API (no user-
 * supplied string content is interpolated into it), and the ::vector cast
 * is part of the static template text, not a parameter.
 *
 * Architecture contract ("Code is Law"):
 *   - This module is read-only. It never writes, validates rules, or narrates.
 *   - Results are advisory context for the AI. Canonical state in the
 *     Campaign/Encounter/Character tables always takes precedence.
 */

import { prisma } from "@/lib/db/prisma";
import { generateEmbedding } from "@/lib/memory/embeddings";

/**
 * Searches the campaign's semantic memory for entries relevant to `query`.
 *
 * Embeds the query, performs a cosine-distance ORDER BY against all
 * MemoryEntry rows for the campaign, and returns the top results as a
 * newline-delimited string ready for injection into a prompt.
 *
 * @param campaignId - The campaign to search within.
 * @param query      - Natural-language topic to recall (e.g. "the dragon king").
 * @param limit      - Maximum number of memories to return (default 3).
 * @returns          Concatenated memory summaries, or a "not found" fallback.
 * @throws           {Error} if embedding generation fails (caller decides handling).
 */
export async function searchMemories(
  campaignId: string,
  query: string,
  limit = 3
): Promise<string> {
  const embedding = await generateEmbedding(query);

  // Build the vector literal from API-returned numbers only — no user input.
  const vectorLiteral = "[" + embedding.join(",") + "]";

  // Composite ranking: semantic similarity × importance weight.
  // (1 - cosine_distance) converts pgvector's distance [0,2] → similarity [1,-1].
  // Multiplying by importance means higher-importance memories surface ahead of
  // equal-similarity ones. At importance=1.0 (the default) the order is identical
  // to pure cosine distance, so existing entries behave as before.
  const rows = await prisma.$queryRaw<Array<{ content: string }>>`
    SELECT content
    FROM   "MemoryEntry"
    WHERE  "campaignId" = ${campaignId}
    ORDER  BY (1 - (embedding <=> ${vectorLiteral}::vector)) * importance DESC
    LIMIT  ${limit}
  `;

  if (rows.length === 0) {
    return "No relevant memories found.";
  }

  return rows.map((r) => r.content).join("\n---\n");
}
