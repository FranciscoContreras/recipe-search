/**
 * Tracked fire-and-forget queue.
 *
 * Replaces the 9 orphan `.then()` patterns scattered across:
 *   - middleware/auth.ts          (touchApiKeyLastUsed)
 *   - index.ts                    (JIT enrichment of /recipes/:id)
 *   - services/nutritionEngine.ts (cache invalidation + upserts + serving updates)
 *   - services/servingEnrichment.ts (cache write-backs)
 *
 * Why:
 *  - Unhandled rejections in orphan `.then()` calls swallow errors silently.
 *  - On SIGTERM we want to finish work in progress before the pool closes,
 *    otherwise the last enrichment update vanishes.
 *
 * The pool's SIGTERM handler in `db/pool.ts` calls `drainBackground()` before
 * `pool.end()` — no extra wiring required at call sites.
 */

const inflight = new Set<Promise<void>>();

/**
 * Register a fire-and-forget promise. Errors are logged but never re-thrown.
 * Adds itself to the in-flight set so `drainBackground()` can await it.
 *
 * Example:
 *   track(updateRecipeNutrition(id, payload));
 */
export function track(p: Promise<void>): void {
    const wrapped = p
        .catch((err) => {
            console.error('[background] task error:', err);
        })
        .finally(() => {
            inflight.delete(wrapped);
        });
    inflight.add(wrapped);
}

/**
 * Wait for all in-flight tracked tasks to settle, but no longer than
 * `timeoutMs` (default 5000). Used by `db/pool.ts` on SIGTERM to drain
 * background work before closing the pool.
 *
 * Resolves either when all tasks settle or when the timeout fires —
 * whichever comes first. Never rejects.
 */
export async function drainBackground(timeoutMs = 5_000): Promise<void> {
    if (inflight.size === 0) return;
    const all      = Promise.allSettled([...inflight]).then(() => undefined);
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    await Promise.race([all, deadline]);
}

/**
 * Number of currently tracked tasks — exported for the /health endpoint
 * so operators can spot a queue that isn't draining.
 */
export function inflightCount(): number {
    return inflight.size;
}
