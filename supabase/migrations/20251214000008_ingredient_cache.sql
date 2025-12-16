-- Create ingredient cache table for the Nutrition Engine
CREATE TABLE public.ingredient_cache (
  term text NOT NULL,
  nutrition jsonb NOT NULL, -- Stored standardized per 100g
  source text NOT NULL DEFAULT 'usda',
  remote_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ingredient_cache_pkey PRIMARY KEY (term)
);

-- Index for fast lookups
CREATE INDEX ingredient_cache_term_idx ON public.ingredient_cache (term);

-- RLS
ALTER TABLE public.ingredient_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON public.ingredient_cache
  FOR SELECT USING (true);

CREATE POLICY "Enable insert for service role" ON public.ingredient_cache
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable update for service role" ON public.ingredient_cache
  FOR UPDATE USING (true);
