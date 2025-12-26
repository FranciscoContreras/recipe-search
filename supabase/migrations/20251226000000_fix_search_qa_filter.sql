-- Fix Search QA Filter
-- Ensures that 'quarantined' and 'rejected' recipes are excluded from search results.

-- 1. Update Simple Search RPC
CREATE OR REPLACE FUNCTION search_recipes(search_query text)
RETURNS SETOF public.recipes AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.recipes
  WHERE 
    qa_status NOT IN ('quarantined', 'rejected') AND
    fts @@ websearch_to_tsquery('english', search_query)
  ORDER BY ts_rank(fts, websearch_to_tsquery('english', search_query)) DESC;
END;
$$ LANGUAGE plpgsql;

-- 2. Update Hybrid Search RPC
CREATE OR REPLACE FUNCTION search_recipes_hybrid(
  search_term text, 
  filter_ingredients text[] DEFAULT null,
  match_all_ingredients boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  name text,
  image text,
  description text,
  cook_time text,
  prep_time text,
  total_time text,
  recipe_ingredients jsonb,
  recipe_instructions jsonb,
  recipe_category text,
  recipe_cuisine text,
  nutrition jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  rank_score float
) AS $$
BEGIN
  -- Case 1: Empty Search Term (Filter by ingredients only, or return recent)
  IF search_term IS NULL OR search_term = '' THEN
    RETURN QUERY
    SELECT 
      r.id, r.name, r.image, r.description, r.cook_time, r.prep_time, r.total_time,
      r.recipe_ingredients, r.recipe_instructions, r.recipe_category, r.recipe_cuisine, r.nutrition,
      r.created_at, r.updated_at,
      0.0::float as rank_score
    FROM public.recipes r
    WHERE 
      r.qa_status NOT IN ('quarantined', 'rejected') AND
      (
        filter_ingredients IS NULL OR 
        (
          match_all_ingredients = true AND r.ingredients_flat @> filter_ingredients
        ) OR (
          match_all_ingredients = false AND r.ingredients_flat && filter_ingredients
        )
      )
    ORDER BY r.created_at DESC
    LIMIT 50;
    RETURN;
  END IF;

  -- Case 2: Text Search (Hybrid: FTS + Fuzzy)
  RETURN QUERY
  WITH matches AS (
    -- Combine exact/stemmed matches (FTS) with fuzzy matches (Trigram)
    -- UNION handles deduplication of IDs efficiently
    SELECT id FROM public.recipes WHERE fts @@ websearch_to_tsquery('english', search_term)
    UNION
    SELECT id FROM public.recipes WHERE name % search_term
  )
  SELECT 
    r.id, r.name, r.image, r.description, r.cook_time, r.prep_time, r.total_time,
    r.recipe_ingredients, r.recipe_instructions, r.recipe_category, r.recipe_cuisine, r.nutrition,
    r.created_at, r.updated_at,
    (
      -- Re-calculate score only for the matched subset
      (similarity(r.name, search_term) * 1.0) +
      (ts_rank(r.fts, websearch_to_tsquery('english', search_term)) * 0.5)
    ) as rank_score
  FROM public.recipes r
  JOIN matches m ON r.id = m.id
  WHERE 
    r.qa_status NOT IN ('quarantined', 'rejected') AND
    (
      filter_ingredients IS NULL OR 
      (
        match_all_ingredients = true AND r.ingredients_flat @> filter_ingredients
      ) OR (
        match_all_ingredients = false AND r.ingredients_flat && filter_ingredients
      )
    )
  ORDER BY rank_score DESC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql;
