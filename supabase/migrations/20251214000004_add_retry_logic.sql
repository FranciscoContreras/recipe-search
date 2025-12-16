-- Add next_retry_at column for cooling down jobs
ALTER TABLE public.crawl_jobs
ADD COLUMN next_retry_at timestamp with time zone null;

-- Add retry_count to track how many times we've tried
ALTER TABLE public.crawl_jobs
ADD COLUMN retry_count int NOT NULL DEFAULT 0;

-- Index for efficient polling
CREATE INDEX crawl_jobs_retry_idx ON public.crawl_jobs (status, next_retry_at);
