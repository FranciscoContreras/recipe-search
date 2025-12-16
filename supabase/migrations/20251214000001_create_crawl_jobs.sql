-- Create a table to track crawl jobs
create table public.crawl_jobs (
  id uuid not null default gen_random_uuid (),
  url text not null,
  status text not null default 'pending', -- pending, processing, completed, failed
  recipes_found int not null default 0,
  log text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint crawl_jobs_pkey primary key (id)
);

-- Enable RLS
alter table public.crawl_jobs enable row level security;

-- Policies
create policy "Enable read access for all users" on public.crawl_jobs
  for select
  using (true);

create policy "Enable insert access for all users" on public.crawl_jobs
  for insert
  with check (true);

create policy "Enable update access for all users" on public.crawl_jobs
  for update
  using (true);
