ALTER TABLE public.api_keys 
ADD COLUMN owner_email text;

-- Add a unique constraint to prevent one email from having multiple active keys (abuse prevention)
-- We use a partial index to only enforce this for active keys
CREATE UNIQUE INDEX api_keys_active_email_idx ON public.api_keys (owner_email) WHERE is_active = true;
