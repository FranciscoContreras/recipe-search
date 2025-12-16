-- Add QA tracking columns
ALTER TABLE public.recipes
ADD COLUMN qa_status text NOT NULL DEFAULT 'pending', -- pending, verified, flagged, repaired
ADD COLUMN last_audited_at timestamp with time zone null,
ADD COLUMN audit_log jsonb DEFAULT '[]'::jsonb,
ADD COLUMN quality_score int DEFAULT 0;

-- Create an index to find 'pending' or old items quickly
CREATE INDEX recipes_qa_idx ON public.recipes (qa_status, last_audited_at);

-- Create a function to calculate quality score automatically
CREATE OR REPLACE FUNCTION calculate_recipe_quality(r public.recipes)
RETURNS int AS $$
DECLARE
  score int := 0;
BEGIN
  -- Basic Metadata
  IF r.name IS NOT NULL AND length(r.name) > 3 THEN score := score + 10; END IF;
  IF r.description IS NOT NULL AND length(r.description) > 10 THEN score := score + 10; END IF;
  
  -- Visuals
  IF r.image IS NOT NULL AND length(r.image) > 10 THEN score := score + 20; END IF;
  
  -- Core Content (Heavy weight)
  IF r.recipe_ingredients IS NOT NULL AND jsonb_array_length(r.recipe_ingredients) > 0 THEN score := score + 25; END IF;
  IF r.recipe_instructions IS NOT NULL AND jsonb_array_length(r.recipe_instructions) > 0 THEN score := score + 25; END IF;
  
  -- Extra Metadata
  IF r.cook_time IS NOT NULL OR r.prep_time IS NOT NULL THEN score := score + 5; END IF;
  IF r.nutrition IS NOT NULL THEN score := score + 5; END IF;

  RETURN score;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
