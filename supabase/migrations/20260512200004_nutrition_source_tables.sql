-- ============================================================
-- LOCAL MIRRORS: Canadian Nutrient File (CNF), FRIDA, AUSNUT
-- ============================================================
-- These tables are populated by sync scripts in src/scripts/:
--   sync_cnf.ts    — Health Canada REST API  (~5,700 foods)
--   sync_frida.ts  — DTU Denmark Excel download (~1,200 foods)
--   sync_ausnut.ts — Food Standards AUS/NZ Excel (~3,741 foods + 9,816 measures)
--
-- All three tables share the same schema so servingEnrichment.ts can
-- query them with a single RPC rather than three separate round-trips.

-- ─── CNF ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cnf_foods (
    food_code           INTEGER PRIMARY KEY,
    food_name           TEXT    NOT NULL,
    -- Nutrition per 100g
    calories_100g       REAL,
    protein_100g        REAL,
    fat_100g            REAL,
    carbs_100g          REAL,
    fiber_100g          REAL,
    sugar_100g          REAL,
    -- Serving / portion
    serving_grams       REAL,           -- conversion_factor_value × 100
    serving_description TEXT,           -- measure_name from CNF API
    -- Full-text search (generated, no manual updates needed)
    fts tsvector GENERATED ALWAYS AS (
        to_tsvector('english', food_name)
    ) STORED
);

CREATE INDEX IF NOT EXISTS cnf_foods_fts_idx  ON public.cnf_foods USING GIN (fts);
CREATE INDEX IF NOT EXISTS cnf_foods_name_idx ON public.cnf_foods (lower(food_name));

ALTER TABLE public.cnf_foods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read"        ON public.cnf_foods FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Service role write" ON public.cnf_foods FOR ALL    TO service_role        USING (true) WITH CHECK (true);

COMMENT ON TABLE public.cnf_foods IS
    'Canadian Nutrient File mirror. Synced via scripts/sync_cnf.ts. Source: https://food-nutrition.canada.ca/api/canadian-nutrient-file/';

-- ─── FRIDA ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.frida_foods (
    food_id             INTEGER PRIMARY KEY,
    food_name           TEXT    NOT NULL,
    food_name_da        TEXT,           -- Danish name (original)
    preparation         TEXT,           -- e.g. "raw", "cooked, boiled"
    -- Nutrition per 100g
    calories_100g       REAL,
    protein_100g        REAL,
    fat_100g            REAL,
    carbs_100g          REAL,
    fiber_100g          REAL,
    sugar_100g          REAL,
    -- Serving / portion
    serving_grams       REAL,           -- reference portion weight
    serving_description TEXT,
    -- Full-text search
    fts tsvector GENERATED ALWAYS AS (
        to_tsvector('english', food_name)
    ) STORED
);

CREATE INDEX IF NOT EXISTS frida_foods_fts_idx  ON public.frida_foods USING GIN (fts);
CREATE INDEX IF NOT EXISTS frida_foods_name_idx ON public.frida_foods (lower(food_name));

ALTER TABLE public.frida_foods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read"        ON public.frida_foods FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Service role write" ON public.frida_foods FOR ALL    TO service_role        USING (true) WITH CHECK (true);

COMMENT ON TABLE public.frida_foods IS
    'FRIDA (DTU Denmark) food composition mirror. Synced via scripts/sync_frida.ts. Download: https://frida.fooddata.dk/data';

-- ─── AUSNUT ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ausnut_foods (
    food_id             TEXT    PRIMARY KEY,    -- 8-digit AUSNUT ID
    food_name           TEXT    NOT NULL,
    food_group          TEXT,
    -- Nutrition per 100g
    calories_100g       REAL,
    protein_100g        REAL,
    fat_100g            REAL,
    carbs_100g          REAL,
    fiber_100g          REAL,
    sugar_100g          REAL,
    sodium_100g         REAL,
    -- Best serving from Food Measures file (9,816 measures for 3,741 foods)
    serving_grams       REAL,
    serving_description TEXT,
    -- Full-text search
    fts tsvector GENERATED ALWAYS AS (
        to_tsvector('english', food_name)
    ) STORED
);

CREATE INDEX IF NOT EXISTS ausnut_foods_fts_idx  ON public.ausnut_foods USING GIN (fts);
CREATE INDEX IF NOT EXISTS ausnut_foods_name_idx ON public.ausnut_foods (lower(food_name));

ALTER TABLE public.ausnut_foods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read"        ON public.ausnut_foods FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Service role write" ON public.ausnut_foods FOR ALL    TO service_role        USING (true) WITH CHECK (true);

COMMENT ON TABLE public.ausnut_foods IS
    'AUSNUT 2023 (Food Standards Australia NZ) mirror. Synced via scripts/sync_ausnut.ts. Download: https://www.foodstandards.gov.au/science-data/food-nutrient-databases/ausnut';

-- ─── Unified serving lookup RPC ───────────────────────────────────────────────
-- Single function so the app makes one round-trip to check all three tables.
-- Returns the best match across CNF + FRIDA + AUSNUT ordered by specificity.

CREATE OR REPLACE FUNCTION public.lookup_serving_size(query_text TEXT)
RETURNS TABLE(
    serving_grams       REAL,
    serving_description TEXT,
    source_table        TEXT,
    food_name           TEXT
)
LANGUAGE sql
STABLE
AS $$
    SELECT serving_grams, serving_description, 'cnf'::TEXT, food_name
    FROM public.cnf_foods
    WHERE fts @@ plainto_tsquery('english', query_text)
      AND serving_grams IS NOT NULL
      AND serving_grams > 0
    ORDER BY ts_rank(fts, plainto_tsquery('english', query_text)) DESC
    LIMIT 1

    UNION ALL

    SELECT serving_grams, serving_description, 'frida'::TEXT, food_name
    FROM public.frida_foods
    WHERE fts @@ plainto_tsquery('english', query_text)
      AND serving_grams IS NOT NULL
      AND serving_grams > 0
    ORDER BY ts_rank(fts, plainto_tsquery('english', query_text)) DESC
    LIMIT 1

    UNION ALL

    SELECT serving_grams, serving_description, 'ausnut'::TEXT, food_name
    FROM public.ausnut_foods
    WHERE fts @@ plainto_tsquery('english', query_text)
      AND serving_grams IS NOT NULL
      AND serving_grams > 0
    ORDER BY ts_rank(fts, plainto_tsquery('english', query_text)) DESC
    LIMIT 1

    ORDER BY 1  -- smallest gram weight first when sources disagree (conservative)
    LIMIT 3;    -- return all three so caller can pick best
$$;
