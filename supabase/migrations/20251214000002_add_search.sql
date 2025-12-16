-- 1. Add a generated column for Full Text Search
-- We concatenate name, description, and ingredients (casted to text)
-- We use 'english' configuration for stemming (e.g., "cooking" -> "cook")
ALTER TABLE public.recipes
ADD COLUMN fts tsvector
GENERATED ALWAYS AS (
  to_tsvector('english', 
    name || ' ' || 
    coalesce(description, '') || ' ' || 
    coalesce(recipe_ingredients::text, '')
  )
) STORED;

-- 2. Create a GIN index for ultra-fast searching
CREATE INDEX recipes_fts_idx ON public.recipes USING GIN (fts);

-- 3. Create a Remote Procedure Call (RPC) function
-- This allows us to call .rpc('search_recipes', { query: '...' }) from the API
CREATE OR REPLACE FUNCTION search_recipes(search_query text)
RETURNS SETOF public.recipes AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.recipes
  WHERE fts @@ websearch_to_tsquery('english', search_query)
  ORDER BY ts_rank(fts, websearch_to_tsquery('english', search_query)) DESC;
END;
$$ LANGUAGE plpgsql;
