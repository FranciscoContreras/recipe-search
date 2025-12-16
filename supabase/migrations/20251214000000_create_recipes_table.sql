-- Drop the old table if it exists
DROP TABLE IF EXISTS public.recipes;

-- Create the recipes table with Schema.org Recipe fields
create table public.recipes (
  id uuid not null default gen_random_uuid (),
  url text null unique, -- Source URL, can be null if manually created
  name text not null,
  image text null,
  description text null,
  cook_time text null, -- ISO 8601 duration
  prep_time text null, -- ISO 8601 duration
  total_time text null, -- ISO 8601 duration
  recipe_yield text null,
  recipe_ingredients jsonb null, -- Array of strings
  recipe_instructions jsonb null, -- Array of strings or objects
  recipe_category text null,
  recipe_cuisine text null,
  nutrition jsonb null, -- Structured nutrition info
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint recipes_pkey primary key (id)
);

-- Enable Row Level Security (RLS)
alter table public.recipes enable row level security;

-- Create a policy that allows anyone to read recipes
create policy "Enable read access for all users" on public.recipes
  for select
  using (true);

-- Create a policy that allows anyone to insert recipes
create policy "Enable insert access for all users" on public.recipes
  for insert
  with check (true);

-- Create a policy that allows anyone to update recipes
create policy "Enable update access for all users" on public.recipes
  for update
  using (true);
