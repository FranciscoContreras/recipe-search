-- Fix: "column reference 'id' is ambiguous" in search_recipes_hybrid.
--
-- In PL/pgSQL, RETURNS TABLE (id uuid, ...) creates an implicit output variable named 'id'.
-- The CTE produced a column also named 'id', causing PostgreSQL to be unable to resolve
-- which 'id' is meant inside the JOIN clause.
--
-- Fix: alias the CTE output column to 'matched_id' so it never clashes with the
-- output variable.

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
  -- Case 1: No search term — return recent recipes (ingredient filter still applied)
  IF search_term IS NULL OR search_term = '' THEN
    RETURN QUERY
    SELECT
      r.id, r.name, r.image, r.description, r.cook_time, r.prep_time, r.total_time,
      r.recipe_ingredients, r.recipe_instructions, r.recipe_category, r.recipe_cuisine, r.nutrition,
      r.created_at, r.updated_at,
      0.0::float AS rank_score
    FROM public.recipes r
    WHERE
      r.qa_status NOT IN ('quarantined', 'rejected')
      AND (
        filter_ingredients IS NULL
        OR (match_all_ingredients = true  AND r.ingredients_flat @> filter_ingredients)
        OR (match_all_ingredients = false AND r.ingredients_flat && filter_ingredients)
      )
    ORDER BY r.created_at DESC
    LIMIT 50;
    RETURN;
  END IF;

  -- Case 2: Hybrid search — FTS union trigram, then score and filter
  -- The CTE column is aliased to 'matched_id' to avoid ambiguity with the
  -- RETURNS TABLE output column named 'id'.
  RETURN QUERY
  WITH matches AS (
    SELECT r1.id AS matched_id
    FROM public.recipes r1
    WHERE r1.fts @@ websearch_to_tsquery('english', search_term)
    UNION
    SELECT r2.id AS matched_id
    FROM public.recipes r2
    WHERE r2.name % search_term
  )
  SELECT
    r.id, r.name, r.image, r.description, r.cook_time, r.prep_time, r.total_time,
    r.recipe_ingredients, r.recipe_instructions, r.recipe_category, r.recipe_cuisine, r.nutrition,
    r.created_at, r.updated_at,
    (
      (similarity(r.name, search_term) * 1.0) +
      (ts_rank(r.fts, websearch_to_tsquery('english', search_term)) * 0.5)
    ) AS rank_score
  FROM public.recipes r
  INNER JOIN matches ON r.id = matches.matched_id
  WHERE
    r.qa_status NOT IN ('quarantined', 'rejected')
    AND (
      filter_ingredients IS NULL
      OR (match_all_ingredients = true  AND r.ingredients_flat @> filter_ingredients)
      OR (match_all_ingredients = false AND r.ingredients_flat && filter_ingredients)
    )
  ORDER BY rank_score DESC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql;
