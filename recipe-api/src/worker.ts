/**
 * Crawl worker — LISTEN/NOTIFY edition.
 *
 * Pre-migration: tight polling loop that hit `next_crawl_job()` every 5–60 s,
 * generating ~5M RPC calls/day across 4 workers.
 *
 * Post-migration: a single LISTEN client wakes us up the instant a new
 * crawl_jobs row lands (trigger lives in self_host_compat migration). A 60 s
 * fallback poll catches anything we miss (dropped notifications, restart races,
 * cooling_down rows whose retry deadline has just elapsed).
 *
 * Each "wake" drains every available job sequentially in this process before
 * going back to sleep. Multiple PM2 instances run in parallel — Postgres'
 * SELECT … FOR UPDATE SKIP LOCKED guarantees each job is claimed exactly once.
 */

import { createListenClient } from './db/listenClient';
import { claimNextCrawlJobAtomic } from './db/queries';
import { RecipeCrawlerService } from './crawler';
import { drainBackground } from './utils/background';

const FALLBACK_POLL_MS = 60_000; // safety net for missed notifications

let shuttingDown = false;
let processing   = false;

/**
 * Atomically claim and process pending jobs until the queue is empty.
 * Re-entrancy guard (`processing`) keeps a flood of NOTIFYs from running
 * the drain loop in parallel within a single process.
 */
async function tryClaimAndProcess(): Promise<void> {
    if (processing || shuttingDown) return;
    processing = true;
    try {
        while (!shuttingDown) {
            const job = await claimNextCrawlJobAtomic();
            if (!job) break;

            // `retry_count` is incremented by the auditor when scheduling
            // auto-repair crawls. The crawler tunes concurrency / retries
            // based on whether this is a retry attempt — pass that through
            // for parity with the old polling worker semantics.
            const isRetry = job.retry_count > 0;

            console.log(
                `[worker] Claimed job ${job.id} for ${job.url}` +
                (isRetry ? ` (retry #${job.retry_count})` : ''),
            );

            try {
                const crawler = new RecipeCrawlerService(job.id, job.url, isRetry);
                await crawler.start();
                console.log(`[worker] Finished ${job.id}`);
            } catch (e) {
                console.error(`[worker] Job ${job.id} threw:`, e);
            }
        }
    } finally {
        processing = false;
    }
}

async function main(): Promise<void> {
    console.log(`[worker] Instance ${process.env.INSTANCE_ID ?? '?'} starting`);

    // Drain anything already pending before subscribing — covers the case where
    // jobs were inserted while the worker was offline.
    await tryClaimAndProcess();

    // Subscribe to the 'crawl_jobs_new' channel. The DB trigger fires NOTIFY
    // for every newly-inserted pending row, so any new POST /crawl wakes us up.
    const listen = await createListenClient('crawl_jobs_new', () => {
        tryClaimAndProcess().catch((e) =>
            console.error('[worker] notify handler error:', e),
        );
    });

    // Safety-net poll. We expect to do almost no work here — notifications
    // cover the happy path. The poll matters when:
    //   • a notification was dropped (TCP reset, OS hiccup)
    //   • a cooling_down job's next_retry_at just became reachable
    const fallback = setInterval(() => {
        tryClaimAndProcess().catch((e) =>
            console.error('[worker] fallback poll err', e),
        );
    }, FALLBACK_POLL_MS);

    const shutdown = async (sig: string) => {
        console.log(`[worker] ${sig} received — shutting down`);
        shuttingDown = true;
        clearInterval(fallback);
        await listen.close();
        await drainBackground();
        process.exit(0);
    };
    process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
    process.on('SIGINT',  () => { void shutdown('SIGINT'); });
}

main().catch((e) => {
    console.error('[worker] fatal', e);
    process.exit(1);
});
