/**
 * Hand-written domain types for the self-hosted Postgres migration.
 *
 * These replace `src/database.types.ts` (which was Supabase-generated).
 * JSONB columns use `unknown` — callers are expected to cast to a more
 * specific shape (e.g. `recipe.recipe_ingredients as string[]`).
 *
 * Column names mirror the SQL migrations in `supabase/migrations/`.
 */

// ─── Shared enums ─────────────────────────────────────────────────────────────

/** Closed set of qa_status values used across the auditor + search filters. */
export type QaStatus =
    | 'pending'
    | 'verified'
    | 'flagged'
    | 'quarantined'
    | 'rejected';

/** Closed set of crawl_jobs.status values. */
export type CrawlJobStatus =
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'blocked'
    | 'cooling_down';

// ─── recipes ──────────────────────────────────────────────────────────────────
// Source: supabase/migrations/20251214000000_create_recipes_table.sql + 20251214000002_add_search.sql
//         + 20251214000005_hybrid_search.sql + 20251214000006_add_qa_system.sql

export interface Recipe {
    id:                  string;          // uuid
    url:                 string | null;
    name:                string;
    image:               string | null;
    description:         string | null;
    cook_time:           string | null;   // ISO-8601 duration
    prep_time:           string | null;
    total_time:          string | null;
    recipe_yield:        string | null;
    recipe_ingredients:  unknown;         // jsonb (typically string[])
    recipe_instructions: unknown;         // jsonb (typically string[] or HowToStep[])
    recipe_category:     string | null;
    recipe_cuisine:      string | null;
    nutrition:           unknown;         // jsonb (varied shapes)
    created_at:          string;          // timestamptz ISO
    updated_at:          string;          // timestamptz ISO
    // Generated columns — read-only
    fts?:                unknown;         // tsvector
    ingredients_flat?:   string[] | null;
    // QA system (migration 20251214000006)
    qa_status:           QaStatus | string; // schema allows arbitrary text — keep loose
    last_audited_at:     string | null;
    audit_log:           unknown;         // jsonb (typically string[])
    quality_score:       number | null;
}

// ─── crawl_jobs ───────────────────────────────────────────────────────────────
// Source: supabase/migrations/20251214000001_create_crawl_jobs.sql
//         + 20251214000003_add_archived_flag.sql + 20251214000004_add_retry_logic.sql

export interface CrawlJob {
    id:             string;             // uuid
    url:            string;
    status:         CrawlJobStatus | string;
    recipes_found:  number;
    log:            string | null;
    created_at:     string;             // timestamptz ISO
    updated_at:     string;             // timestamptz ISO
    is_archived:    boolean;
    next_retry_at:  string | null;      // timestamptz ISO
    retry_count:    number;
    // Added in self-host-compat migration (background queue support):
    progress?:      number | null;      // optional progress percentage
}

// ─── ingredient_cache ─────────────────────────────────────────────────────────
// Source: supabase/migrations/20251214000008_ingredient_cache.sql
//         + 20260512200003_ingredient_cache_serving.sql

export interface IngredientCacheEntry {
    term:                string;        // primary key
    nutrition:           unknown;       // jsonb — per-100g standardized
    source:              string;        // 'usda' | 'openfoodfacts' | 'fatsecret' | 'baseline' | ...
    remote_id:           string | null;
    created_at:          string;
    updated_at:          string;
    serving_grams:       number | null; // real
    serving_description: string | null;
}

// ─── off_products ─────────────────────────────────────────────────────────────
// Source: supabase/migrations/20260511000001_off_products_table.sql
//         + 20260511000002_off_products_expand_schema.sql
// NOTE: In the new self-hosted setup these queries hit the local Postgres,
//       where the table exists but is typically empty (the real OFF mirror lives
//       in the separate `off_mirror` database — see `offDbClient.ts`).

export interface OffProduct {
    code:              string;            // primary key — EAN/UPC barcode
    product_name:      string | null;
    brands:            string | null;
    // Per-100g nutrition (REAL columns)
    calories_100g:     number | null;
    protein_100g:      number | null;
    fat_100g:          number | null;
    carbs_100g:        number | null;
    fiber_100g:        number | null;
    sugar_100g:        number | null;
    sodium_100g:       number | null;
    calcium_100g:      number | null;
    iron_100g:         number | null;
    vitamin_c_100g:    number | null;
    nutriscore_grade:  string | null;
    last_modified_t:   number | null;
    synced_at:         string | null;     // timestamptz ISO
    // Extended schema columns
    ingredients_text:  string | null;
    allergens_tags:    string[] | null;
    traces_tags:       string[] | null;
    additives_tags:    string[] | null;
    nova_group:        number | null;
    ecoscore_grade:    string | null;
    labels_tags:       string[] | null;
    categories_tags:   string[] | null;
    quantity:          string | null;
    image_url:         string | null;
    // Per-serving data (used by servingEnrichment fallback)
    serving_quantity?:  number | null;
    serving_size_text?: string | null;
    // fts column is omitted — generated tsvector, not directly queried by app code
}

// ─── cnf_foods / frida_foods / ausnut_foods ───────────────────────────────────
// Source: supabase/migrations/20260512200004_nutrition_source_tables.sql

export interface CnfFood {
    food_code:           number;          // integer primary key
    food_name:           string;
    calories_100g:       number | null;
    protein_100g:        number | null;
    fat_100g:            number | null;
    carbs_100g:          number | null;
    fiber_100g:          number | null;
    sugar_100g:          number | null;
    serving_grams:       number | null;
    serving_description: string | null;
}

export interface FridaFood {
    food_id:             number;          // integer primary key
    food_name:           string;
    food_name_da:        string | null;
    preparation:         string | null;
    calories_100g:       number | null;
    protein_100g:        number | null;
    fat_100g:            number | null;
    carbs_100g:          number | null;
    fiber_100g:          number | null;
    sugar_100g:          number | null;
    serving_grams:       number | null;
    serving_description: string | null;
}

export interface AusnutFood {
    food_id:             string;          // 8-digit text id
    food_name:           string;
    food_group:          string | null;
    calories_100g:       number | null;
    protein_100g:        number | null;
    fat_100g:            number | null;
    carbs_100g:          number | null;
    fiber_100g:          number | null;
    sugar_100g:          number | null;
    sodium_100g:         number | null;
    serving_grams:       number | null;
    serving_description: string | null;
}

// ─── api_keys ─────────────────────────────────────────────────────────────────
// Source: supabase/migrations/20251225000002_add_api_keys.sql
//         + 20251225000003_add_email_to_keys.sql

export interface ApiKey {
    id:             string;            // uuid
    key_hash:       string;            // SHA-256 hex
    owner_name:     string;
    owner_email:    string | null;
    is_active:      boolean;
    last_used_at:   string | null;
    created_at:     string;
    expires_at:     string | null;
}

// ─── recipe_stats (materialized view) ─────────────────────────────────────────
// Source: supabase/migrations/20260512000001_database_optimizations.sql

export interface RecipeStats {
    total:             number | null;
    verified:          number | null;
    flagged:           number | null;
    quarantined:       number | null;
    rejected:          number | null;
    pending:           number | null;
    avg_quality_score: number | null;   // numeric — pg may return as string
    computed_at:       string | null;
}
