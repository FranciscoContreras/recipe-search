-- Open Food Facts local mirror table.
-- Stores nutrition per 100g for 4M+ packaged products, synced weekly from the OFF CSV dump.
-- This replaces live HTTP calls to openfoodfacts.org, eliminating 503 errors and rate limits.

CREATE TABLE IF NOT EXISTS public.off_products (
    code             TEXT PRIMARY KEY,          -- EAN-13 / UPC barcode
    product_name     TEXT,
    brands           TEXT,
    -- Nutrition per 100g (all REAL to keep storage tight)
    calories_100g    REAL,
    protein_100g     REAL,
    fat_100g         REAL,
    carbs_100g       REAL,
    fiber_100g       REAL,
    sugar_100g       REAL,
    sodium_100g      REAL,
    calcium_100g     REAL,                      -- stored in mg/100g
    iron_100g        REAL,                      -- stored in mg/100g
    vitamin_c_100g   REAL,                      -- stored in mg/100g
    nutriscore_grade TEXT,                       -- a/b/c/d/e or null
    last_modified_t  BIGINT,                    -- UNIX timestamp from OFF (used for delta sync)
    synced_at        TIMESTAMPTZ DEFAULT now()
);

-- Fast barcode lookup
CREATE INDEX IF NOT EXISTS off_products_code_idx     ON public.off_products (code);

-- Full-text search on product name + brand
ALTER TABLE public.off_products
    ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (
        to_tsvector('english',
            coalesce(product_name, '') || ' ' || coalesce(brands, ''))
    ) STORED;

CREATE INDEX IF NOT EXISTS off_products_fts_idx ON public.off_products USING GIN (fts);

-- Partial index to filter out products with no useful nutrition data
-- Only products with at least calories populated are worth searching
CREATE INDEX IF NOT EXISTS off_products_has_cal_idx
    ON public.off_products (product_name)
    WHERE calories_100g IS NOT NULL AND calories_100g > 0;

-- RLS: readable by anyone with anon key, writeable only by service role (sync script)
ALTER TABLE public.off_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON public.off_products
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Service role write" ON public.off_products
    FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.off_products IS
    'Open Food Facts mirror. Synced weekly via scripts/sync_off.ts. Source: https://world.openfoodfacts.org/data';
