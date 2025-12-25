-- Create a table for API keys
CREATE TABLE IF NOT EXISTS public.api_keys (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    key_hash text NOT NULL, -- Store the SHA-256 hash of the key, never the raw key
    owner_name text NOT NULL, -- Who does this key belong to?
    is_active boolean DEFAULT true,
    last_used_at timestamptz,
    created_at timestamptz DEFAULT now(),
    expires_at timestamptz
);

-- Enable RLS
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Policy: Only service role (admin) can do anything.
-- Anonymous/Public users cannot read or write to this table.
CREATE POLICY "Service role only" ON public.api_keys
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Index for fast lookups by hash
CREATE INDEX api_keys_hash_idx ON public.api_keys (key_hash);
