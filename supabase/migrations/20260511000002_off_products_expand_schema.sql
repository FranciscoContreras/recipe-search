-- Expand off_products with allergen, label, processing, and ingredient data.
-- These fields unlock dietary filtering, food quality scoring, and ingredient analysis.

ALTER TABLE public.off_products
    ADD COLUMN IF NOT EXISTS ingredients_text   TEXT,       -- Full ingredient list as on the label
    ADD COLUMN IF NOT EXISTS allergens_tags     TEXT[],     -- e.g. {en:milk, en:gluten, en:peanuts}
    ADD COLUMN IF NOT EXISTS traces_tags        TEXT[],     -- "May contain" allergens
    ADD COLUMN IF NOT EXISTS additives_tags     TEXT[],     -- E-numbers: {en:e621, en:e330, ...}
    ADD COLUMN IF NOT EXISTS nova_group         SMALLINT,   -- 1=whole food, 4=ultra-processed
    ADD COLUMN IF NOT EXISTS ecoscore_grade     TEXT,       -- a/b/c/d/e
    ADD COLUMN IF NOT EXISTS labels_tags        TEXT[],     -- vegan, vegetarian, organic, gluten-free...
    ADD COLUMN IF NOT EXISTS categories_tags    TEXT[],     -- en:beverages, en:dairy-products, ...
    ADD COLUMN IF NOT EXISTS quantity           TEXT,       -- "330 ml", "500 g"
    ADD COLUMN IF NOT EXISTS image_url          TEXT;       -- Product photo URL

-- Index for allergen filtering (e.g. find all gluten-free products)
CREATE INDEX IF NOT EXISTS off_products_allergens_idx
    ON public.off_products USING GIN (allergens_tags);

-- Index for label filtering (vegan, organic, etc.)
CREATE INDEX IF NOT EXISTS off_products_labels_idx
    ON public.off_products USING GIN (labels_tags);

-- Index for category browsing
CREATE INDEX IF NOT EXISTS off_products_categories_idx
    ON public.off_products USING GIN (categories_tags);

-- Index for nova_group (quickly find all ultra-processed products)
CREATE INDEX IF NOT EXISTS off_products_nova_idx
    ON public.off_products (nova_group)
    WHERE nova_group IS NOT NULL;
