/**
 * Single `pg.Pool` per process for the self-hosted Postgres migration.
 *
 * Reads `DATABASE_URL` from `.env` (mandatory). Same dotenv-loading pattern
 * as `offDbClient.ts` — resolved from `recipe-api/.env` regardless of cwd.
 *
 * Replaces `src/supabaseClient.ts`.
 *
 * Pool sizing notes:
 *  - VPS has 7.7 GB RAM, two PM2 workers + auditor process — keep per-process
 *    connections low (default 10). Override with PG_POOL_MAX when needed.
 *  - LISTEN/NOTIFY MUST use a dedicated `pg.Client` — see `listenClient.ts`.
 *
 * Graceful shutdown:
 *  - On SIGTERM we drain in-flight background tasks (via `utils/background.ts`)
 *    and then close the pool. Process should exit cleanly within ~5s.
 */

import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    // Don't throw at import time — tests and one-off scripts that don't touch
    // the pool should still be importable. Throw on first `pool` usage instead.
    console.warn('[db/pool] DATABASE_URL is not set. Calls to the pool will fail.');
}

const POOL_MAX = parseInt(process.env.PG_POOL_MAX || '10', 10);

export const pool = new Pool({
    connectionString:        DATABASE_URL,
    max:                     POOL_MAX,
    idleTimeoutMillis:       30_000,
    connectionTimeoutMillis: 5_000,
});

// Pool-level error handler so a single broken connection never crashes the process.
pool.on('error', (err) => {
    console.error('[db/pool] idle client error:', err.message);
});

/**
 * Acquire a client, run `fn`, then release the client back to the pool.
 * Use this for any sequence of queries that must share a connection
 * (transactions, SET LOCAL, advisory locks, etc.).
 *
 * Example:
 *   await withClient(async (client) => {
 *     await client.query('BEGIN');
 *     await client.query('UPDATE …');
 *     await client.query('COMMIT');
 *   });
 */
export async function withClient<T>(
    fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const client = await pool.connect();
    try {
        return await fn(client);
    } finally {
        client.release();
    }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Lazy-loaded so this file has no hard dependency on utils/background.ts
// (avoids a circular import for callers that only need the pool).

let shuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[db/pool] ${signal} received — draining background tasks…`);
    try {
        // Use a dynamic require to avoid load-order issues during early init.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { drainBackground } = require('../utils/background');
        await drainBackground(5_000);
    } catch (err) {
        console.error('[db/pool] drainBackground error:', err);
    }
    try {
        await pool.end();
        console.log('[db/pool] pool closed.');
    } catch (err) {
        console.error('[db/pool] pool.end() error:', err);
    }
}

process.on('SIGTERM', () => { gracefulShutdown('SIGTERM').then(() => process.exit(0)); });
process.on('SIGINT',  () => { gracefulShutdown('SIGINT').then(()  => process.exit(0)); });
