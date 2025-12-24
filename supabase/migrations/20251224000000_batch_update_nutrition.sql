create or replace function update_recipe_nutritions(payload jsonb)
returns void
language plpgsql
as $$
declare
  item jsonb;
begin
  for item in select * from jsonb_array_elements(payload)
  loop
    update public.recipes
    set nutrition = item->'nutrition'
    where id = (item->>'id')::uuid;
  end loop;
end;
$$;
