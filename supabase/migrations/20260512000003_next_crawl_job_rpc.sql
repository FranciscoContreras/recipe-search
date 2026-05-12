-- Replaces the OR-based worker poll query with UNION ALL so the planner
-- can use the two partial indexes independently instead of seq-scanning.
--
-- Before: OR condition → seq scan of 19k rows × 80k times/day
-- After:  UNION ALL    → two index scans of ~10 rows each

CREATE OR REPLACE FUNCTION next_crawl_job()
RETURNS SETOF public.crawl_jobs LANGUAGE sql STABLE AS $$
    SELECT * FROM (
        -- Branch 1: oldest pending job (uses crawl_jobs_pending_poll_idx)
        (
            SELECT * FROM public.crawl_jobs
            WHERE is_archived = false AND status = 'pending'
            ORDER BY created_at ASC
            LIMIT 1
        )
        UNION ALL
        -- Branch 2: cooling_down job whose retry time has passed (uses crawl_jobs_cooling_poll_idx)
        (
            SELECT * FROM public.crawl_jobs
            WHERE is_archived = false AND status = 'cooling_down' AND next_retry_at <= now()
            ORDER BY next_retry_at ASC
            LIMIT 1
        )
    ) candidates
    ORDER BY created_at ASC
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION next_crawl_job() TO authenticated, service_role, anon;
