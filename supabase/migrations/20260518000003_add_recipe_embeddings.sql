-- Add a pgvector embedding column + HNSW index to recipes for semantic search.
--
-- 1536 dimensions matches OpenAI text-embedding-3-small (default in
-- src/services/embeddings.ts). If you swap providers, ALTER the column type
-- to the new dimensionality — pgvector enforces it.
--
-- The index uses cosine distance (`vector_cosine_ops`) — the right choice for
-- text embeddings (rotation-invariant; the magnitude of an embedding doesn't
-- carry semantic meaning).
--
-- HNSW index defaults: m=16, ef_construction=64. These are fine for ~10⁵-10⁶
-- rows. Recall @ 10 will be ~99%. Tune ef_search at query time if needed.

ALTER TABLE public.recipes
    ADD COLUMN IF NOT EXISTS embedding vector(1536),
    ADD COLUMN IF NOT EXISTS embedding_model TEXT,        -- e.g. 'text-embedding-3-small'
    ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

-- HNSW index — only over rows that actually have an embedding (partial).
-- Without the WHERE, every NULL row consumes graph space for nothing.
CREATE INDEX IF NOT EXISTS recipes_embedding_hnsw_idx
    ON public.recipes
    USING hnsw (embedding vector_cosine_ops)
    WHERE embedding IS NOT NULL;

-- Bonus index to make the backfill script's "WHERE embedding IS NULL" fast.
CREATE INDEX IF NOT EXISTS recipes_embedding_pending_idx
    ON public.recipes (created_at)
    WHERE embedding IS NULL
      AND qa_status NOT IN ('quarantined', 'rejected');

COMMENT ON COLUMN public.recipes.embedding IS
    'Dense vector embedding of (name + description + ingredients_text). Populated by src/scripts/backfill_embeddings.ts. Used by /search/semantic.';
