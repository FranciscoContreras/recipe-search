# Semantic recipe search (pgvector)

The migration `20260518000003_add_recipe_embeddings.sql` adds:

- `recipes.embedding vector(1536)` — pgvector column.
- `recipes.embedding_model TEXT` — provider/model identifier.
- `recipes.embedded_at TIMESTAMPTZ` — last embed time.
- `recipes_embedding_hnsw_idx` — HNSW (cosine) over rows that have an embedding.
- `recipes_embedding_pending_idx` — partial index over rows needing a backfill.

`POST /search/semantic { query, limit? }` embeds the query and returns recipes
ranked by cosine similarity. Until embeddings are backfilled, the endpoint
returns rows but ranking is meaningless (or it returns `503` if no provider
is configured).

## One-time setup

### 1. Apply the migration

The migration ships in `supabase/migrations/`. Apply via:

```bash
DATABASE_URL=postgresql://recipe_owner:<pw>@localhost:5432/recipe_base \
  npx ts-node src/scripts/migrate.ts
```

Verify:

```bash
sudo -u postgres psql -d recipe_base -c "\d recipes" | grep embedding
```

### 2. Pick a provider

**Option A — OpenAI `text-embedding-3-small`** (1536 dims, $0.02/1M tokens, default):

```env
EMBEDDING_PROVIDER=openai            # the default; can omit
OPENAI_API_KEY=sk-proj-...
```

**Option B — Google `gemini-embedding-001`** (1536 dims via Matryoshka,
$0.15/1M tokens — pricier per token but free if you have AI Studio credits):

```env
EMBEDDING_PROVIDER=google
GOOGLE_API_KEY=AIza...               # get one at https://aistudio.google.com/apikey
```

Both default to 1536 dimensions, matching the existing `vector(1536)` column —
swap providers freely via `EMBEDDING_PROVIDER` and re-run the backfill, no
schema change needed.

To use a different dimensionality, update the migration's `vector(N)` AND set
`EMBEDDING_DIMENSIONS=N`, then re-run the backfill.

### 3. Backfill (~5 min, ~$0.12 OpenAI / ~$0.86 Google for 23K recipes)

```bash
# OpenAI:
DATABASE_URL=postgresql://recipe_app:<pw>@localhost:5432/recipe_base \
OPENAI_API_KEY=sk-... \
  npx ts-node src/scripts/backfill_embeddings.ts

# Google:
DATABASE_URL=postgresql://recipe_app:<pw>@localhost:5432/recipe_base \
EMBEDDING_PROVIDER=google GOOGLE_API_KEY=AIza... \
  npx ts-node src/scripts/backfill_embeddings.ts
```

The script is resumable — if it crashes, re-run. It only processes recipes
where `embedding IS NULL`.

Flags:

- `--batch 50` — recipes per API call (default 50; OpenAI accepts up to 2048).
- `--limit 1000` — stop after N recipes (useful for cost-control during testing).
- `--dry-run` — print plan, hit no APIs.

Coverage check:

```bash
sudo -u postgres psql -d recipe_base -c "
SELECT
    count(*) FILTER (WHERE embedding IS NOT NULL) AS embedded,
    count(*) AS total,
    round(100.0 * count(*) FILTER (WHERE embedding IS NOT NULL) / count(*), 1) AS pct
  FROM recipes
 WHERE qa_status NOT IN ('quarantined','rejected');
"
```

### 4. Test

```bash
curl -X POST -H "x-api-key: <KEY>" -H "content-type: application/json" \
  -d '{"query":"warm hearty winter stew with root vegetables","limit":5}' \
  https://recipe-base.wearemachina.com/search/semantic | jq
```

Each result includes `similarity` between 0 (orthogonal) and 1 (identical).
For the cuisine-/category-keyword inputs used by the embedder, expect
0.45–0.65 for good matches, 0.30–0.45 for plausible, < 0.30 for weak.

## Re-embedding strategy

When `recipeEmbeddingText()` in `src/services/embeddings.ts` changes, every
embedding becomes stale and must be recomputed. A future-proof approach:

```bash
# Mark all embeddings as stale
sudo -u postgres psql -d recipe_base -c "UPDATE recipes SET embedding = NULL"
# Re-run backfill
DATABASE_URL=... OPENAI_API_KEY=... npx ts-node src/scripts/backfill_embeddings.ts
```

For incremental updates (new recipes added by the crawler), schedule the
backfill via cron — runs nightly, embeds anything new since yesterday:

```cron
30 4 * * *   wearemachina-recipe-base cd /home/wearemachina-recipe-base/htdocs/recipe-base.wearemachina.com && npx ts-node src/scripts/backfill_embeddings.ts --batch 100 >> /var/log/recipe-embeddings.log 2>&1
```

(Not installed by default — uncomment when you're ready to spend incrementally.)

## Cost expectations

Token usage per recipe (name + description + ingredients): ~200-300 tokens
average. For 23K recipes:

| Provider / Model | Cost / 1M tokens | One-time backfill | Per new recipe |
|---|---|---|---|
| OpenAI `text-embedding-3-small` (default) | $0.020 | ~$0.12 | trivial |
| OpenAI `text-embedding-3-large` | $0.130 | ~$0.75 | trivial |
| Google `gemini-embedding-001` | $0.150 | ~$0.86 | trivial |
| Google `text-embedding-004` | $0.025 | ~$0.14 | trivial |

Query cost: same per-call rate, ~$0.000001 per `/search/semantic` request.
Negligible.

## Query-time tuning

`hnsw.ef_search` controls the recall/speed tradeoff at query time (default 40).
For higher recall on important queries:

```sql
SET LOCAL hnsw.ef_search = 100;
SELECT * FROM search_recipes_semantic(...);
```

The wrapper function doesn't expose this; bump it inline if you need to.

## Future work

- **Hybrid ranking**: combine `searchRecipesHybrid` (FTS + trigram) with
  `searchRecipesSemantic` for the best of both. Sketch: take top-50 of each,
  Reciprocal Rank Fusion, return top-10.
- **Query embedding cache**: a small LRU keyed on the query string would
  eliminate the per-request OpenAI call for repeated queries.
- **Local provider**: an Ollama-based `embed-text` provider would eliminate
  the API cost. Add `EMBEDDING_PROVIDER=ollama` to the selector.
