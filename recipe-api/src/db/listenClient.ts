/**
 * Dedicated session connection for LISTEN/NOTIFY.
 *
 * Why a dedicated `pg.Client` (not a `pool.connect()` client):
 *  - LISTEN is a session-level state. Returning the client to the pool would
 *    silently lose subscriptions.
 *  - pgBouncer in transaction mode is incompatible with LISTEN — we use a raw
 *    client to keep that escape hatch open even if pooling is introduced later.
 *
 * Reconnection strategy:
 *  - On any `error` or `end` event from the connection, reconnect with
 *    exponential backoff (1s → cap 30s).
 *  - Re-issue `LISTEN <channel>` after each successful reconnect so we don't
 *    silently miss notifications.
 *
 * Replaces the polling loop in `src/worker.ts` (cuts ~5M polls/day).
 */

import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS     = 30_000;

export interface ListenHandle {
    /** Stop listening and close the underlying client. */
    close: () => Promise<void>;
}

/**
 * Subscribe to a Postgres LISTEN channel. Returns a handle whose `close()`
 * tears down the connection cleanly. The connection self-heals on errors.
 *
 * Example (worker):
 *   const sub = await createListenClient('crawl_jobs_new', (id) => {
 *     console.log('new job', id);
 *   });
 *   // …
 *   await sub.close();
 */
export async function createListenClient(
    channel:   string,
    onMessage: (payload: string) => void,
): Promise<ListenHandle> {
    if (!DATABASE_URL) {
        throw new Error('[db/listenClient] DATABASE_URL is required.');
    }

    let client:           Client | null = null;
    let closed                          = false;
    let backoffMs                       = INITIAL_BACKOFF_MS;
    let reconnectTimer:   NodeJS.Timeout | null = null;

    const cleanupClient = async () => {
        if (!client) return;
        try {
            client.removeAllListeners();
            await client.end();
        } catch {
            // ignore — we're already in a bad state
        } finally {
            client = null;
        }
    };

    const scheduleReconnect = () => {
        if (closed) return;
        if (reconnectTimer) return; // already scheduled
        console.warn(`[db/listenClient] reconnecting to "${channel}" in ${backoffMs}ms`);
        reconnectTimer = setTimeout(async () => {
            reconnectTimer = null;
            await connect();
        }, backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    };

    const connect = async (): Promise<void> => {
        if (closed) return;
        await cleanupClient();

        const c = new Client({ connectionString: DATABASE_URL });
        client = c;

        c.on('error', (err) => {
            console.error(`[db/listenClient] "${channel}" error:`, err.message);
            scheduleReconnect();
        });
        c.on('end', () => {
            if (closed) return;
            console.warn(`[db/listenClient] "${channel}" connection ended unexpectedly.`);
            scheduleReconnect();
        });
        c.on('notification', (msg) => {
            // Defensive: only forward messages for the channel we asked for.
            if (msg.channel === channel) {
                try {
                    onMessage(msg.payload ?? '');
                } catch (handlerErr) {
                    console.error(`[db/listenClient] "${channel}" handler error:`, handlerErr);
                }
            }
        });

        try {
            await c.connect();
            await c.query(`LISTEN ${escapeIdentifier(channel)}`);
            console.log(`[db/listenClient] subscribed to "${channel}"`);
            backoffMs = INITIAL_BACKOFF_MS; // reset on success
        } catch (err: any) {
            console.error(`[db/listenClient] connect failed for "${channel}":`, err.message);
            scheduleReconnect();
        }
    };

    await connect();

    return {
        close: async () => {
            closed = true;
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            if (client) {
                try {
                    await client.query(`UNLISTEN ${escapeIdentifier(channel)}`);
                } catch {
                    // ignore — likely already disconnected
                }
            }
            await cleanupClient();
        },
    };
}

/**
 * Quote a Postgres identifier for safe interpolation into `LISTEN`/`UNLISTEN`.
 * We don't trust `channel` to be free of quotes — it's user-controlled in
 * principle. Doubles any `"` and wraps in `"…"`.
 */
function escapeIdentifier(name: string): string {
    return '"' + name.replace(/"/g, '""') + '"';
}
