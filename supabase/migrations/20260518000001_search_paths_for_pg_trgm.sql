-- Self-host fix: pin `search_path` on every function that uses `pg_trgm`.
--
-- `20251225000000_fix_security_warnings.sql` moved pg_trgm into the
-- `extensions` schema and pinned `search_path = public, extensions, pg_temp`
-- on the then-existing functions. But later migrations recreated some of
-- those functions WITHOUT carrying the SET search_path clause forward, so
-- on a fresh apply they end up with the default `"$user", public` path —
-- and the trigram `%` operator + `similarity()` function become invisible.
--
-- The hybrid search functions are the visible victim — `/search?q=chicken`
-- returns 0 rows because the trigram branch raises
-- `operator does not exist: text % text`.
--
-- Re-pin the search_path. Safe and idempotent.

ALTER FUNCTION public.search_recipes_hybrid(text, text[], boolean)
    SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.search_recipes(text)
    SET search_path = public, extensions, pg_temp;

-- These don't use pg_trgm today but pinning is harmless and matches the
-- security-warnings migration's intent for every public function.
ALTER FUNCTION public.update_recipe_nutritions(jsonb)
    SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.fn_ingredients_to_array(jsonb)
    SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.calculate_recipe_quality(public.recipes)
    SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.refresh_materialized_view_stats()
    SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.next_crawl_job()
    SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.lookup_serving_size(text)
    SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.audit_pending_batch(integer)
    SET search_path = public, extensions, pg_temp;
