/**
 * lib/memory/embeddings.ts
 *
 * Thin I/O wrapper around the OpenAI Embeddings API via the Vercel AI SDK.
 *
 * Responsibility: convert a text string into a 1536-dimensional float vector.
 * No game logic, no database access, no side effects beyond the API call.
 *
 * Model: text-embedding-3-small — 1536 dimensions, cost-effective for
 * per-event recall in a single-player campaign context.
 */

import { embed } from "ai";
import { openai } from "@ai-sdk/openai";

const EMBEDDING_MODEL = openai.embedding("text-embedding-3-small");

/**
 * Generates a 1536-dimensional embedding vector for the given text.
 *
 * @param text - The string to embed. Must be non-empty.
 * @returns    A number[] of length 1536 representing the semantic vector.
 * @throws     {Error} if `text` is empty or the API call fails.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (text.trim().length === 0) {
    throw new Error("generateEmbedding: text must not be empty.");
  }

  const { embedding } = await embed({
    model: EMBEDDING_MODEL,
    value: text,
  });

  return embedding;
}
