-- Add serving size columns to ingredient_cache.
--
-- serving_grams: the gram weight of one standard item/portion for count-based
--   ingredients (e.g. bacon strip = 8g, medium apple = 182g). Populated by the
--   servingEnrichment pipeline (USDA portions → CNF → FRIDA → AUSNUT → LLM).
--   Once set, the hardcoded unitToGrams heuristic table is bypassed entirely.
--
-- serving_description: human-readable label from the source
--   (e.g. "1 slice, cooked", "1 medium", "1 cup cooked").

ALTER TABLE public.ingredient_cache
    ADD COLUMN IF NOT EXISTS serving_grams       REAL,
    ADD COLUMN IF NOT EXISTS serving_description TEXT;

-- Index so we can quickly find cache entries that still need enrichment
CREATE INDEX IF NOT EXISTS ingredient_cache_missing_serving_idx
    ON public.ingredient_cache (term)
    WHERE serving_grams IS NULL;

COMMENT ON COLUMN public.ingredient_cache.serving_grams IS
    'Grams per one standard item/serving. Source: USDA portions, CNF, FRIDA, AUSNUT, or LLM. Bypasses unitToGrams heuristic when populated.';
COMMENT ON COLUMN public.ingredient_cache.serving_description IS
    'Human-readable serving label from the source database (e.g. "1 slice, cooked").';
