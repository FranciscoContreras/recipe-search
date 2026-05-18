-- Self-host fix: grant USAGE on the `extensions` schema to recipe_app and
-- recipe_readonly so SECURITY INVOKER functions (like search_recipes_hybrid)
-- can resolve the pg_trgm `%` operator and `similarity()` function that live
-- there after 20251225000000_fix_security_warnings.sql moved pg_trgm out of
-- public.
--
-- Even though the function declares `search_path = public, extensions, pg_temp`,
-- a SECURITY INVOKER call still runs with the *caller's* schema privileges.
-- recipe_app didn't have USAGE on extensions, so the trigram operator was
-- unreachable and `/search?q=...` raised
-- "operator does not exist: text % text".

GRANT USAGE ON SCHEMA extensions TO recipe_app, recipe_readonly;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO recipe_app, recipe_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA extensions
    GRANT EXECUTE ON FUNCTIONS TO recipe_app, recipe_readonly;
