-- 1. Enable pg_trgm for fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Helper function to extract text array from jsonb (Immutable for generated column)
CREATE OR REPLACE FUNCTION fn_ingredients_to_array(ingredients jsonb)
RETURNS text[] AS $$
BEGIN
  -- Handle nulls or non-arrays gracefully
  IF ingredients IS NULL OR jsonb_typeof(ingredients) != 'array' THEN
    RETURN ARRAY[]::text[];
  END IF;
  
  RETURN ARRAY(SELECT jsonb_array_elements_text(ingredients));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. Create the clean array column using the helper function
ALTER TABLE public.recipes
ADD COLUMN ingredients_flat text[]
GENERATED ALWAYS AS ( fn_ingredients_to_array(recipe_ingredients) ) STORED;

-- 4. Indexes
CREATE INDEX recipes_ingredients_flat_idx ON public.recipes USING GIN (ingredients_flat);
CREATE INDEX recipes_name_trgm_idx ON public.recipes USING GIN (name gin_trgm_ops);

-- 5. The "World Class" Search Algorithm (Hybrid)
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
  RETURN QUERY
  SELECT 
    r.id, r.name, r.image, r.description, r.cook_time, r.prep_time, r.total_time,
    r.recipe_ingredients, r.recipe_instructions, r.recipe_category, r.recipe_cuisine, r.nutrition,
    r.created_at, r.updated_at,
    (
      -- SCORING ALGORITHM
      (similarity(r.name, search_term) * 1.0) +
      (ts_rank(r.fts, websearch_to_tsquery('english', search_term)) * 0.5)
    ) as rank_score
  FROM public.recipes r
  WHERE 
    -- A. Text Search Match
    (
      search_term IS NULL OR search_term = '' OR
      r.fts @@ websearch_to_tsquery('english', search_term) OR 
      r.name % search_term 
    )
    
    AND
    
    -- B. Ingredient Filtering
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