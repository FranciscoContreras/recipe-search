-- Deduplication Migration
-- Deletes older records that have the same name, keeping the most recently updated one.

DELETE FROM public.recipes
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY name 
             ORDER BY updated_at DESC, created_at DESC
           ) as row_num
    FROM public.recipes
  ) t
  WHERE t.row_num > 1
);
