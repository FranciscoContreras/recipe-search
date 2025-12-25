-- Fix "Extension in Public" warning
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

-- Move pg_trgm to extensions schema if it's currently in public
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm' AND extnamespace = 'public'::regnamespace) THEN
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  END IF;
END $$;

-- Fix "Function Search Path Mutable" warnings
-- Setting search_path explicitly mitigates search_path hijacking attacks

-- 1. update_recipe_nutritions
ALTER FUNCTION public.update_recipe_nutritions(jsonb) SET search_path = public, extensions, pg_temp;

-- 2. fn_ingredients_to_array
ALTER FUNCTION public.fn_ingredients_to_array(jsonb) SET search_path = public, extensions, pg_temp;

-- 3. calculate_recipe_quality
ALTER FUNCTION public.calculate_recipe_quality(public.recipes) SET search_path = public, extensions, pg_temp;

-- 4. search_recipes
ALTER FUNCTION public.search_recipes(text) SET search_path = public, extensions, pg_temp;

-- 5. search_recipes_hybrid
ALTER FUNCTION public.search_recipes_hybrid(text, text[], boolean) SET search_path = public, extensions, pg_temp;
