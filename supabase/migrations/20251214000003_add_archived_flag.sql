-- Add is_archived column to crawl_jobs
ALTER TABLE public.crawl_jobs
ADD COLUMN is_archived boolean NOT NULL DEFAULT false;

-- Create index for faster filtering
CREATE INDEX crawl_jobs_archived_idx ON public.crawl_jobs (is_archived);
