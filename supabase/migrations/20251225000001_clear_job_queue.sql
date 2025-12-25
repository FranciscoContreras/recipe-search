-- Bulk cancel all active or pending jobs to stop the loop
UPDATE crawl_jobs
SET status = 'failed', is_archived = true, log = 'Bulk cancelled during fix'
WHERE status IN ('pending', 'processing', 'cooling_down', 'blocked') AND is_archived = false;
