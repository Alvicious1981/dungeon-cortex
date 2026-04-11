-- Add HNSW index on MemoryEntry.embedding for efficient approximate nearest-neighbour
-- cosine similarity searches via pgvector's <=> operator.
--
-- Parameters:
--   m = 16              max number of connections per layer (controls index build cost vs recall trade-off)
--   ef_construction = 64  size of the dynamic candidate list during build (higher = better recall, slower build)
--
-- This index is only beneficial once the campaign accumulates many MemoryEntry rows.
-- At small row counts Postgres will ignore it and use a sequential scan, which is safe.
CREATE INDEX "MemoryEntry_embedding_hnsw_idx"
ON "MemoryEntry"
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
