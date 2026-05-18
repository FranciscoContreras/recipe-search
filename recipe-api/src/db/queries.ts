/**
 * Typed per-call-site query functions for the self-hosted Postgres.
 *
 * Every function:
 *  - takes raw arguments + an optional `client?: PoolClient` for transaction composition
 *  - uses parameterized placeholders ($1, $2, …) — never string interpolation
 *  - is grouped by table/feature with `// region` comments
 *
 * Each function carries a one-line comment naming the original Supabase
 * call site it replaces (file:line), so Agent C can grep-and-replace cleanly.
 *
 * Replaces all `supabase.from(...)` / `supabase.rpc(...)` calls across:
 *   index.ts, auditor.ts, worker.ts, crawler.ts, middleware/auth.ts,
 *   services/{nutritionEngine,servingEnrichment,openFoodFacts}.ts
 */

import type { PoolClient, QueryResultRow } from 'pg';
import { pool } from './pool';
import type {
    Recipe,
    CrawlJob,
    IngredientCacheEntry,
    OffProduct,
    ApiKey,
    RecipeStats,
} from './types';

// ─── Internal helpers ─────────────────────────────────────────────────────────

type Runner = Pick<PoolClient, 'query'> | typeof pool;

/** Run a query on the supplied client, or on the pool if none provided. */
function run<T extends QueryResultRow>(
    runner: Runner | undefined,
    text:   string,
    params: ReadonlyArray<unknown>,
): Promise<{ rows: T[]; rowCount: number | null }> {
    const r = runner ?? pool;
    return (r as Runner).query<T>(text, params as unknown[]) as unknown as Promise<{
        rows: T[];
        rowCount: number | null;
    }>;
}

/** Build "col = $n" SET clauses for partial UPDATEs. */
function buildSet(
    fields: Record<string, unknown>,
    startIndex = 1,
): { sql: string; values: unknown[]; nextIndex: number } {
    const keys   = Object.keys(fields);
    const values = keys.map((k) => fields[k]);
    const parts  = keys.map((k, i) => `${k} = $${startIndex + i}`);
    return { sql: parts.join(', '), values, nextIndex: startIndex + keys.length };
}

/** Column lists used in many places — kept as constants so they stay in sync. */
const RECIPE_COLUMNS_FULL = `
    id, url, name, image, description,
    cook_time, prep_time, total_time, recipe_yield,
    recipe_ingredients, recipe_instructions,
    recipe_category, recipe_cuisine,
    nutrition,
    created_at, updated_at,
    ingredients_flat,
    qa_status, last_audited_at, audit_log, quality_score
`.replace(/\s+/g, ' ').trim();

const RECIPE_COLUMNS_LIST = `
    id, name, image, description, cook_time, prep_time
`.replace(/\s+/g, ' ').trim();

const CRAWL_JOB_COLUMNS = `
    id, url, status, recipes_found, log,
    created_at, updated_at, is_archived,
    next_retry_at, retry_count
`.replace(/\s+/g, ' ').trim();

// =============================================================================
// region recipes
// =============================================================================

// Replaces: src/index.ts:321  supabase.from('recipes').select('*').eq('id', id)…single()
export async function getRecipeById(
    id:     string,
    client?: PoolClient,
): Promise<Recipe | null> {
    const { rows } = await run<Recipe>(
        client,
        `SELECT ${RECIPE_COLUMNS_FULL}
         FROM recipes
         WHERE id = $1
         LIMIT 1`,
        [id],
    );
    return rows[0] ?? null;
}

// Replaces: src/index.ts:117  supabase.from('recipes').select('*').eq('id', id).neq('qa_status', 'quarantined').neq('qa_status', 'rejected').single()
export async function getRecipeForSsr(
    id:     string,
    client?: PoolClient,
): Promise<Recipe | null> {
    const { rows } = await run<Recipe>(
        client,
        `SELECT ${RECIPE_COLUMNS_FULL}
         FROM recipes
         WHERE id = $1
           AND qa_status NOT IN ('quarantined', 'rejected')
         LIMIT 1`,
        [id],
    );
    return rows[0] ?? null;
}

// Replaces: src/index.ts:285  GET /recipes — paged list with count
export async function listRecipes(
    opts:   { page: number; limit: number; full: boolean },
    client?: PoolClient,
): Promise<{ rows: Recipe[]; count: number }> {
    const offset = Math.max(0, (opts.page - 1) * opts.limit);
    const cols   = opts.full ? RECIPE_COLUMNS_FULL : RECIPE_COLUMNS_LIST;

    // Single round-trip: window function for the total count alongside rows.
    const { rows } = await run<Recipe & { __total: string }>(
        client,
        `SELECT ${cols}, COUNT(*) OVER() AS __total
         FROM recipes
         WHERE qa_status NOT IN ('quarantined', 'rejected')
         ORDER BY created_at DESC
         OFFSET $1
         LIMIT  $2`,
        [offset, opts.limit],
    );

    const count = rows.length > 0 ? parseInt(rows[0].__total, 10) : 0;
    const out   = rows.map(({ __total, ...rest }) => rest as Recipe);
    return { rows: out, count };
}

// Replaces: src/index.ts:227  supabase.from('recipes').insert([newRecipe]).select()
export async function insertRecipe(
    data:   Partial<Recipe>,
    client?: PoolClient,
): Promise<Recipe> {
    const keys   = Object.keys(data);
    if (keys.length === 0) {
        throw new Error('insertRecipe: no fields supplied');
    }
    const values = keys.map((k) => (data as Record<string, unknown>)[k]);
    const cols   = keys.join(', ');
    const ph     = keys.map((_, i) => `$${i + 1}`).join(', ');

    const { rows } = await run<Recipe>(
        client,
        `INSERT INTO recipes (${cols})
         VALUES (${ph})
         RETURNING ${RECIPE_COLUMNS_FULL}`,
        values,
    );
    return rows[0];
}

// Replaces: src/index.ts:345  supabase.from('recipes').select('*').in('id', ids)…
export async function getRecipesByIds(
    ids:    string[],
    client?: PoolClient,
): Promise<Recipe[]> {
    if (ids.length === 0) return [];
    const { rows } = await run<Recipe>(
        client,
        `SELECT ${RECIPE_COLUMNS_FULL}
         FROM recipes
         WHERE id = ANY($1::uuid[])
           AND qa_status NOT IN ('quarantined', 'rejected')`,
        [ids],
    );
    return rows;
}

// Replaces: src/index.ts:332  supabase.from('recipes').update({ nutrition }).eq('id', id)
export async function updateRecipeNutrition(
    id:        string,
    nutrition: unknown,
    client?:   PoolClient,
): Promise<void> {
    await run(
        client,
        `UPDATE recipes
            SET nutrition  = $1::jsonb,
                updated_at = now()
          WHERE id = $2`,
        [JSON.stringify(nutrition), id],
    );
}

// Replaces: src/index.ts:88-105  paged sitemap loop selecting id, updated_at
export async function streamPublicRecipesForSitemap(
    opts: {
        onBatch:    (rows: { id: string; updated_at: string | null }[]) => Promise<void>;
        batchSize?: number;
    },
    client?: PoolClient,
): Promise<void> {
    const limit  = opts.batchSize ?? 1000;
    let   offset = 0;
    // Loop until a short page tells us we're done.
    // We keep ordering stable so the sitemap is deterministic between runs.
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const { rows } = await run<{ id: string; updated_at: string | null }>(
            client,
            `SELECT id, updated_at
             FROM recipes
             WHERE qa_status NOT IN ('quarantined', 'rejected')
             ORDER BY created_at DESC
             OFFSET $1
             LIMIT  $2`,
            [offset, limit],
        );
        if (rows.length === 0) return;
        await opts.onBatch(rows);
        if (rows.length < limit) return;
        offset += limit;
    }
}

// Replaces: src/index.ts:169  supabase.from('recipes').select('id, name, qa_status, quality_score, audit_log').not('last_audited_at',…).order(…).limit(10)
export async function getRecentlyAudited(
    limit:  number,
    client?: PoolClient,
): Promise<Array<Pick<Recipe, 'id' | 'name' | 'qa_status' | 'quality_score' | 'audit_log'>>> {
    const { rows } = await run<
        Pick<Recipe, 'id' | 'name' | 'qa_status' | 'quality_score' | 'audit_log'>
    >(
        client,
        `SELECT id, name, qa_status, quality_score, audit_log
         FROM recipes
         WHERE last_audited_at IS NOT NULL
         ORDER BY last_audited_at DESC
         LIMIT $1`,
        [limit],
    );
    return rows;
}

// Replaces: src/index.ts:164  supabase.from('recipe_stats').select(…).single()
export async function getRecipeStats(
    client?: PoolClient,
): Promise<RecipeStats | null> {
    const { rows } = await run<RecipeStats>(
        client,
        `SELECT total, verified, flagged, quarantined, pending,
                rejected,
                avg_quality_score, computed_at
         FROM recipe_stats
         LIMIT 1`,
        [],
    );
    return rows[0] ?? null;
}

// Replaces: src/index.ts:652  supabase.rpc('search_recipes_hybrid', {...})
export async function searchRecipesHybrid(
    searchTerm:  string,
    ingredients: string[] | null,
    matchAll:    boolean,
    client?:     PoolClient,
): Promise<Recipe[]> {
    const { rows } = await run<Recipe>(
        client,
        `SELECT * FROM search_recipes_hybrid($1, $2::text[], $3)`,
        [searchTerm, ingredients, matchAll],
    );
    return rows;
}

// Semantic search via pgvector — caller computes the query embedding via
// `getEmbeddingProvider().embed(query)`, passes the vector here.
// Returns recipes ranked by cosine similarity (1.0 = identical, 0 = orthogonal).
// Public-status filter is applied; the HNSW index handles the rest.
export interface RecipeWithScore extends Recipe { similarity: number }
export async function searchRecipesSemantic(
    queryEmbeddingLiteral: string,  // e.g. "[0.1,0.2,...]" — use toPgVectorLiteral()
    limit:                 number,
    client?:               PoolClient,
): Promise<RecipeWithScore[]> {
    const { rows } = await run<RecipeWithScore>(
        client,
        `SELECT ${RECIPE_COLUMNS_LIST},
                1 - (embedding <=> $1::vector) AS similarity
           FROM recipes
          WHERE embedding IS NOT NULL
            AND qa_status NOT IN ('quarantined', 'rejected')
          ORDER BY embedding <=> $1::vector
          LIMIT $2`,
        [queryEmbeddingLiteral, limit],
    );
    return rows;
}

// Replaces: src/index.ts:646  fallback "no query" path on /search
export async function listRecipesDefault(
    opts:   { full: boolean; limit?: number },
    client?: PoolClient,
): Promise<Recipe[]> {
    const cols  = opts.full ? RECIPE_COLUMNS_FULL : RECIPE_COLUMNS_LIST;
    const limit = opts.limit ?? 50;
    const { rows } = await run<Recipe>(
        client,
        `SELECT ${cols}
         FROM recipes
         WHERE qa_status NOT IN ('quarantined', 'rejected')
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit],
    );
    return rows;
}

// Replaces: src/auditor.ts:29-33  the auditor's BATCH_SIZE recipe pull
export async function getPendingAuditBatch(
    limit:  number,
    client?: PoolClient,
): Promise<Recipe[]> {
    // Selects ONLY the columns the auditor needs (id, name, image, ingredients,
    // instructions, nutrition, qa_status, url, retry_count, audit_log, last_audited_at).
    // retry_count lives on crawl_jobs — for backwards-compat we emit 0 here.
    // (The auditor's retry logic is keyed off the crawl_jobs row, not the recipe.)
    const { rows } = await run<Recipe>(
        client,
        `SELECT id, name, image,
                recipe_ingredients, recipe_instructions,
                nutrition, qa_status, url,
                audit_log, last_audited_at,
                0                       AS retry_count
         FROM recipes
         WHERE qa_status = 'pending'
            OR last_audited_at IS NULL
         ORDER BY created_at ASC
         LIMIT $1`,
        [limit],
    );
    return rows;
}

// Replaces: src/auditor.ts:193  supabase.from('recipes').update(updatePayload).eq('id', recipe.id)
export async function updateAuditResult(
    id:      string,
    payload: {
        qa_status:       string;
        quality_score:   number;
        last_audited_at: string;
        audit_log:       string[];
        nutrition?:      unknown;
        name?:           string;
        image?:          string;
    },
    client?: PoolClient,
): Promise<void> {
    // Build the dynamic SET clause so optional fields are only updated when present.
    const fields: Record<string, unknown> = {
        qa_status:       payload.qa_status,
        quality_score:   payload.quality_score,
        last_audited_at: payload.last_audited_at,
        audit_log:       JSON.stringify(payload.audit_log),
        updated_at:      new Date().toISOString(),
    };
    if (payload.nutrition !== undefined) fields.nutrition = JSON.stringify(payload.nutrition);
    if (payload.name      !== undefined) fields.name      = payload.name;
    if (payload.image     !== undefined) fields.image     = payload.image;

    const { sql: setSql, values, nextIndex } = buildSet(fields, 1);
    await run(
        client,
        `UPDATE recipes
            SET ${setSql}
          WHERE id = $${nextIndex}`,
        [...values, id],
    );
}

// Replaces: src/crawler.ts:243  supabase.from('recipes').upsert({...}, { onConflict: 'url' })
export async function upsertRecipeByUrl(
    data:   Partial<Recipe>,
    client?: PoolClient,
): Promise<void> {
    const keys = Object.keys(data);
    if (keys.length === 0) return;

    const values = keys.map((k) => {
        const v = (data as Record<string, unknown>)[k];
        // jsonb columns: serialize to text so pg infers ::jsonb cast cleanly.
        if (
            (k === 'nutrition' || k === 'recipe_ingredients' || k === 'recipe_instructions' || k === 'audit_log')
            && v !== null && v !== undefined
        ) {
            return typeof v === 'string' ? v : JSON.stringify(v);
        }
        return v;
    });
    const cols = keys.join(', ');
    const ph   = keys.map((_, i) => `$${i + 1}`).join(', ');

    // UPDATE clause: set every supplied column except `url` (the conflict target)
    // plus updated_at. Use EXCLUDED.<col> so values are taken from the proposed row.
    const updateCols = keys.filter((k) => k !== 'url' && k !== 'created_at');
    const updateSql  = updateCols.length > 0
        ? updateCols.map((k) => `${k} = EXCLUDED.${k}`).join(', ')
        : 'updated_at = now()'; // degenerate case — keep the row touched

    await run(
        client,
        `INSERT INTO recipes (${cols})
         VALUES (${ph})
         ON CONFLICT (url) DO UPDATE
            SET ${updateSql},
                updated_at = now()`,
        values,
    );
}

// endregion recipes

// =============================================================================
// region crawl_jobs
// =============================================================================

// Replaces: src/index.ts:665  supabase.from('crawl_jobs').insert([{ url, status: 'pending' }]).select().single()
export async function createCrawlJob(
    url:    string,
    client?: PoolClient,
): Promise<CrawlJob> {
    const { rows } = await run<CrawlJob>(
        client,
        `INSERT INTO crawl_jobs (url, status)
         VALUES ($1, 'pending')
         RETURNING ${CRAWL_JOB_COLUMNS}`,
        [url],
    );
    return rows[0];
}

// Replaces: src/index.ts:671  supabase.from('crawl_jobs').select('*').eq('is_archived', false).order(…).limit(20)
export async function listActiveCrawlJobs(
    client?: PoolClient,
): Promise<CrawlJob[]> {
    const { rows } = await run<CrawlJob>(
        client,
        `SELECT ${CRAWL_JOB_COLUMNS}
         FROM crawl_jobs
         WHERE is_archived = false
         ORDER BY created_at DESC
         LIMIT 20`,
        [],
    );
    return rows;
}

// Replaces: src/index.ts:677  supabase.from('crawl_jobs').select('*').eq('is_archived', true).order(…).limit(5)
export async function listArchivedCrawlJobs(
    client?: PoolClient,
): Promise<CrawlJob[]> {
    const { rows } = await run<CrawlJob>(
        client,
        `SELECT ${CRAWL_JOB_COLUMNS}
         FROM crawl_jobs
         WHERE is_archived = true
         ORDER BY updated_at DESC
         LIMIT 5`,
        [],
    );
    return rows;
}

// Replaces: src/index.ts:684  supabase.from('crawl_jobs').select('*').eq('id', id).single()
export async function getCrawlJobById(
    id:     string,
    client?: PoolClient,
): Promise<CrawlJob | null> {
    const { rows } = await run<CrawlJob>(
        client,
        `SELECT ${CRAWL_JOB_COLUMNS}
         FROM crawl_jobs
         WHERE id = $1
         LIMIT 1`,
        [id],
    );
    return rows[0] ?? null;
}

// Replaces: src/index.ts:691  DELETE /jobs/:id — archive a single job
export async function archiveCrawlJob(
    id:     string,
    log?:    string,
    client?: PoolClient,
): Promise<void> {
    await run(
        client,
        `UPDATE crawl_jobs
            SET is_archived = true,
                status      = 'failed',
                log         = COALESCE($2, log),
                updated_at  = now()
          WHERE id = $1`,
        [id, log ?? null],
    );
}

// Replaces: src/index.ts:697  DELETE /jobs — archive everything still active
export async function archiveAllActiveCrawlJobs(
    log?:    string,
    client?: PoolClient,
): Promise<void> {
    await run(
        client,
        `UPDATE crawl_jobs
            SET is_archived = true,
                status      = 'failed',
                log         = COALESCE($1, log),
                updated_at  = now()
          WHERE is_archived = false`,
        [log ?? null],
    );
}

// Replaces: src/worker.ts:16  supabase.rpc('next_crawl_job')
export async function nextCrawlJob(
    client?: PoolClient,
): Promise<CrawlJob | null> {
    const { rows } = await run<CrawlJob>(
        client,
        `SELECT ${CRAWL_JOB_COLUMNS}
         FROM next_crawl_job()
         LIMIT 1`,
        [],
    );
    return rows[0] ?? null;
}

// Replaces: src/worker.ts:30  supabase.from('crawl_jobs').update({ status:'processing', … }).eq('id', job.id)
// Used by the polling fallback path. The LISTEN/NOTIFY path uses claimNextCrawlJobAtomic() instead.
export async function claimCrawlJob(
    id:         string,
    retryCount: number,
    isRetry:    boolean,
    client?:    PoolClient,
): Promise<void> {
    await run(
        client,
        `UPDATE crawl_jobs
            SET status        = 'processing',
                next_retry_at = NULL,
                retry_count   = $2,
                updated_at    = now()
          WHERE id = $1`,
        [id, isRetry ? retryCount + 1 : retryCount],
    );
}

// NEW: claim primitive for the LISTEN/NOTIFY worker — SKIP LOCKED-safe.
// Single-statement atomic claim so two workers can't grab the same job.
export async function claimNextCrawlJobAtomic(
    client?: PoolClient,
): Promise<CrawlJob | null> {
    const { rows } = await run<CrawlJob>(
        client,
        `UPDATE crawl_jobs
            SET status        = 'processing',
                next_retry_at = NULL,
                updated_at    = now()
          WHERE id = (
              SELECT id
              FROM crawl_jobs
              WHERE is_archived = false
                AND ( status = 'pending'
                   OR (status = 'cooling_down' AND next_retry_at <= now()) )
              ORDER BY created_at ASC
              FOR UPDATE SKIP LOCKED
              LIMIT 1
          )
          RETURNING ${CRAWL_JOB_COLUMNS}`,
        [],
    );
    return rows[0] ?? null;
}

// Replaces: src/crawler.ts:289-300  updateJobStatus + updateJobProgress
// One generic update so the crawler doesn't need two near-identical helpers.
export async function updateCrawlJobStatus(
    id:     string,
    fields: Partial<Pick<CrawlJob,
        'status' | 'log' | 'next_retry_at' | 'retry_count' | 'is_archived' | 'recipes_found' | 'progress'
    >>,
    client?: PoolClient,
): Promise<void> {
    const keys = Object.keys(fields) as Array<keyof typeof fields>;
    if (keys.length === 0) return;

    const cleaned: Record<string, unknown> = {};
    for (const k of keys) {
        const v = fields[k];
        if (v === undefined) continue;
        cleaned[k as string] = v;
    }
    cleaned.updated_at = new Date().toISOString();

    const { sql: setSql, values, nextIndex } = buildSet(cleaned, 1);
    await run(
        client,
        `UPDATE crawl_jobs
            SET ${setSql}
          WHERE id = $${nextIndex}`,
        [...values, id],
    );
}

// Replaces: src/auditor.ts:133  supabase.from('crawl_jobs').select('id, retry_count').eq('url', url).in('status', […]).single()
export async function findExistingActiveJobForUrl(
    url:    string,
    client?: PoolClient,
): Promise<{ id: string; retry_count: number } | null> {
    const { rows } = await run<{ id: string; retry_count: number }>(
        client,
        `SELECT id, retry_count
         FROM crawl_jobs
         WHERE url = $1
           AND status IN ('pending', 'processing', 'cooling_down')
         ORDER BY updated_at DESC
         LIMIT 1`,
        [url],
    );
    return rows[0] ?? null;
}

// Replaces: src/auditor.ts:141  supabase.from('crawl_jobs').select('retry_count, updated_at').eq('url', url).neq('status', 'pending')…single()
export async function findLastJobForUrl(
    url:    string,
    client?: PoolClient,
): Promise<{ retry_count: number; updated_at: string | null } | null> {
    const { rows } = await run<{ retry_count: number; updated_at: string | null }>(
        client,
        `SELECT retry_count, updated_at
         FROM crawl_jobs
         WHERE url = $1
           AND status <> 'pending'
         ORDER BY updated_at DESC
         LIMIT 1`,
        [url],
    );
    return rows[0] ?? null;
}

// endregion crawl_jobs

// =============================================================================
// region ingredient_cache
// =============================================================================

// Replaces: src/services/nutritionEngine.ts:867  supabase.from('ingredient_cache').select('*').eq('term', cacheKey).single()
export async function getCachedIngredient(
    term:   string,
    client?: PoolClient,
): Promise<IngredientCacheEntry | null> {
    const { rows } = await run<IngredientCacheEntry>(
        client,
        `SELECT term, nutrition, source, remote_id,
                created_at, updated_at,
                serving_grams, serving_description
         FROM ingredient_cache
         WHERE term = $1
         LIMIT 1`,
        [term],
    );
    return rows[0] ?? null;
}

// Replaces: src/services/nutritionEngine.ts:955/997/1012/1026  supabase.from('ingredient_cache').upsert({ term, nutrition, source })
export async function upsertIngredientCache(
    term:      string,
    nutrition: unknown,
    source:    string,
    client?:   PoolClient,
): Promise<void> {
    await run(
        client,
        `INSERT INTO ingredient_cache (term, nutrition, source)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (term) DO UPDATE
            SET nutrition  = EXCLUDED.nutrition,
                source     = EXCLUDED.source,
                updated_at = now()`,
        [term, JSON.stringify(nutrition), source],
    );
}

// Replaces: src/services/nutritionEngine.ts:1065  ingredient_cache.update({ serving_grams, serving_description }).eq('term', cacheKey)
// Also: src/services/servingEnrichment.ts:252-258
export async function updateIngredientCacheServing(
    term:               string,
    servingGrams:       number,
    servingDescription: string | null,
    client?:            PoolClient,
): Promise<void> {
    await run(
        client,
        `UPDATE ingredient_cache
            SET serving_grams       = $2,
                serving_description = $3,
                updated_at          = now()
          WHERE term = $1`,
        [term, servingGrams, servingDescription],
    );
}

// Replaces: src/services/nutritionEngine.ts:936  supabase.from('ingredient_cache').delete().eq('term', cacheKey)
export async function deleteIngredientCache(
    term:   string,
    client?: PoolClient,
): Promise<void> {
    await run(
        client,
        `DELETE FROM ingredient_cache WHERE term = $1`,
        [term],
    );
}

// endregion ingredient_cache

// =============================================================================
// region off_products (fallback path — VPS off_mirror is the real source)
// =============================================================================
//
// NOTE: After migration these queries will hit the public.off_products table
// on the self-hosted Postgres, which is typically empty — the live OFF mirror
// lives in the separate `off_mirror` database accessed via `offDbClient.ts`.
// The functions are kept so the openFoodFacts.ts fallback chain still
// type-checks; they simply return null/empty on a clean install.

// Replaces: src/services/openFoodFacts.ts:95  off_products text search
export async function searchOffProductsFts(
    query:  string,
    client?: PoolClient,
): Promise<Pick<
    OffProduct,
    | 'product_name'
    | 'calories_100g' | 'protein_100g' | 'fat_100g' | 'carbs_100g'
    | 'fiber_100g'    | 'sugar_100g'   | 'calcium_100g' | 'iron_100g'
    | 'vitamin_c_100g'
> | null> {
    const { rows } = await run<Pick<
        OffProduct,
        | 'product_name'
        | 'calories_100g' | 'protein_100g' | 'fat_100g' | 'carbs_100g'
        | 'fiber_100g'    | 'sugar_100g'   | 'calcium_100g' | 'iron_100g'
        | 'vitamin_c_100g'
    >>(
        client,
        `SELECT product_name,
                calories_100g, protein_100g, fat_100g, carbs_100g,
                fiber_100g, sugar_100g, calcium_100g, iron_100g, vitamin_c_100g
         FROM off_products
         WHERE fts @@ websearch_to_tsquery('english', $1)
           AND calories_100g IS NOT NULL
           AND calories_100g > 0
         LIMIT 1`,
        [query],
    );
    return rows[0] ?? null;
}

// Replaces: src/services/openFoodFacts.ts:116  off_products by barcode
export async function getOffProductByBarcode(
    code:   string,
    client?: PoolClient,
): Promise<OffProduct | null> {
    const { rows } = await run<OffProduct>(
        client,
        `SELECT code, product_name, brands, quantity,
                calories_100g, protein_100g, fat_100g, carbs_100g,
                fiber_100g, sugar_100g, sodium_100g, calcium_100g, iron_100g, vitamin_c_100g,
                nutriscore_grade, nova_group, ecoscore_grade,
                ingredients_text,
                allergens_tags, traces_tags, additives_tags,
                labels_tags, categories_tags,
                image_url, last_modified_t, synced_at
         FROM off_products
         WHERE code = $1
         LIMIT 1`,
        [code],
    );
    return rows[0] ?? null;
}

// Replaces: src/services/servingEnrichment.ts:131  off_products serving search
export async function searchOffServingSize(
    query:  string,
    client?: PoolClient,
): Promise<Array<{
    product_name:      string | null;
    serving_quantity:  number | null;
    serving_size_text: string | null;
}>> {
    const { rows } = await run<{
        product_name:      string | null;
        serving_quantity:  number | null;
        serving_size_text: string | null;
    }>(
        client,
        `SELECT product_name, serving_quantity, serving_size_text
         FROM off_products
         WHERE fts @@ websearch_to_tsquery('english', $1)
           AND serving_quantity IS NOT NULL
           AND serving_quantity > 0
           AND serving_quantity < 600
         ORDER BY serving_quantity ASC
         LIMIT 3`,
        [query],
    );
    return rows;
}

// endregion off_products

// =============================================================================
// region serving size
// =============================================================================

// Replaces: src/services/servingEnrichment.ts:96  supabase.rpc('lookup_serving_size', { query_text })
export async function lookupServingSize(
    queryText: string,
    client?:   PoolClient,
): Promise<Array<{
    serving_grams:       number;
    serving_description: string | null;
    source_table:        string;
    food_name:           string;
}>> {
    const { rows } = await run<{
        serving_grams:       number;
        serving_description: string | null;
        source_table:        string;
        food_name:           string;
    }>(
        client,
        `SELECT serving_grams, serving_description, source_table, food_name
         FROM lookup_serving_size($1)`,
        [queryText],
    );
    return rows;
}

// endregion serving size

// =============================================================================
// region api_keys
// =============================================================================

// Replaces: src/middleware/auth.ts:50  adminSupabase.from('api_keys').select('id, is_active').eq('key_hash', hash).eq('is_active', true).single()
export async function findActiveApiKeyByHash(
    hash:   string,
    client?: PoolClient,
): Promise<{ id: string; is_active: boolean } | null> {
    const { rows } = await run<{ id: string; is_active: boolean }>(
        client,
        `SELECT id, is_active
         FROM api_keys
         WHERE key_hash = $1
           AND is_active = true
         LIMIT 1`,
        [hash],
    );
    return rows[0] ?? null;
}

// Replaces: src/middleware/auth.ts:62  api_keys.update({ last_used_at }).eq('id', id) (fire-and-forget)
export async function touchApiKeyLastUsed(
    id:     string,
    client?: PoolClient,
): Promise<void> {
    await run(
        client,
        `UPDATE api_keys
            SET last_used_at = now()
          WHERE id = $1`,
        [id],
    );
}

// endregion api_keys

// =============================================================================
// region system RPCs
// =============================================================================

// Replaces: src/index.ts:152  supabase.rpc('refresh_materialized_view_stats')
export async function refreshRecipeStats(client?: PoolClient): Promise<void> {
    await run(client, `SELECT refresh_materialized_view_stats()`, []);
}

// Replaces: src/index.ts:363  supabase.rpc('update_recipe_nutritions', { payload })
export async function updateRecipeNutritionsBatch(
    payload: Array<{ id: string; nutrition: unknown }>,
    client?: PoolClient,
): Promise<void> {
    if (payload.length === 0) return;
    await run(
        client,
        `SELECT update_recipe_nutritions($1::jsonb)`,
        [JSON.stringify(payload)],
    );
}

// endregion system RPCs

/** Re-export so callers can pass a typed client around without importing pg directly. */
export type { PoolClient } from 'pg';

/** Convenience re-export so call sites only need to import from 'db/queries'. */
export { pool, withClient } from './pool';
