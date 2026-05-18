#!/usr/bin/env ts-node
/**
 * Backfill recipe embeddings.
 *
 * Reads recipes WHERE embedding IS NULL AND qa_status NOT IN (...),
 * batches them through the EmbeddingProvider (default OpenAI), writes
 * embeddings back. Idempotent and resumable — re-run after a crash.
 *
 * Usage:
 *   DATABASE_URL=postgresql://recipe_app:pw@localhost:5432/recipe_base \
 *   OPENAI_API_KEY=sk-... \
 *     npx ts-node src/scripts/backfill_embeddings.ts [--batch 50] [--limit 1000]
 *
 * Flags:
 *   --batch N  — recipes per API call (default 50; OpenAI accepts up to 2048)
 *   --limit N  — stop after N recipes (default: process all)
 *   --dry-run  — print what would happen, no API calls, no writes
 *
 * Approximate cost for 23K recipes with text-embedding-3-small:
 *   ~5M tokens × $0.02 / 1M = ~$0.10  (total, one time).
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { pool } from '../db/pool';
import { getEmbeddingProvider, recipeEmbeddingText, toPgVectorLiteral } from '../services/embeddings';

interface CliArgs {
    batchSize: number;
    limit:     number | null;
    dryRun:    boolean;
}

function parseArgs(argv: string[]): CliArgs {
    let batchSize = 50;
    let limit: number | null = null;
    let dryRun = false;
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if      (a === '--batch')   batchSize = parseInt(argv[++i], 10);
        else if (a === '--limit')   limit     = parseInt(argv[++i], 10);
        else if (a === '--dry-run') dryRun    = true;
        else if (a === '--help' || a === '-h') {
            console.log('Usage: backfill_embeddings [--batch N] [--limit N] [--dry-run]');
            process.exit(0);
        }
    }
    return { batchSize, limit, dryRun };
}

async function fetchBatch(batchSize: number): Promise<Array<{ id: string; name: string; description: string | null; recipe_ingredients: unknown; recipe_category: string | null; recipe_cuisine: string | null }>> {
    const { rows } = await pool.query(`
        SELECT id, name, description, recipe_ingredients, recipe_category, recipe_cuisine
          FROM recipes
         WHERE embedding IS NULL
           AND qa_status NOT IN ('quarantined', 'rejected')
         ORDER BY created_at
         LIMIT $1
    `, [batchSize]);
    return rows;
}

async function writeBatch(
    items: Array<{ id: string; embedding: number[] }>,
    model: string,
): Promise<void> {
    if (items.length === 0) return;
    // One UPDATE per row — pg can't ::vector cast through a single composite
    // UNNEST cleanly, and a per-row UPDATE is still ≪1ms locally.
    const sql = `
        UPDATE recipes
           SET embedding       = $2::vector,
               embedding_model = $3,
               embedded_at     = now()
         WHERE id = $1
    `;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const it of items) {
            await client.query(sql, [it.id, toPgVectorLiteral(it.embedding), model]);
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
    } finally {
        client.release();
    }
}

async function main(): Promise<void> {
    const args     = parseArgs(process.argv);
    const provider = getEmbeddingProvider();

    console.log(`[backfill] provider=${provider.name} model=${provider.model} dims=${provider.dimensions}`);
    console.log(`[backfill] batch=${args.batchSize} limit=${args.limit ?? 'unlimited'} dryRun=${args.dryRun}`);

    let total       = 0;
    let withError   = 0;
    const startedAt = Date.now();

    while (true) {
        const remaining = args.limit !== null ? args.limit - total : args.batchSize;
        if (remaining <= 0) break;
        const fetchSize = Math.min(args.batchSize, remaining);

        const batch = await fetchBatch(fetchSize);
        if (batch.length === 0) {
            console.log('[backfill] no more recipes need embeddings.');
            break;
        }

        const texts = batch.map(recipeEmbeddingText);

        if (args.dryRun) {
            console.log(`[backfill] DRY-RUN would embed ${batch.length} recipes (${texts.reduce((s, t) => s + t.length, 0)} chars)`);
            total += batch.length;
            continue;
        }

        try {
            const vectors = await provider.embedBatch(texts);
            const items = batch.map((r, i) => ({ id: r.id, embedding: vectors[i] }));
            await writeBatch(items, provider.model);
            total += batch.length;
            const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
            const rate    = (total / parseFloat(elapsed)).toFixed(1);
            process.stdout.write(`  embedded ${total} (${rate}/s, ${elapsed}s elapsed)\r`);
        } catch (e: any) {
            withError++;
            console.error(`\n[backfill] batch error (will retry on next run): ${e.message}`);
            if (withError >= 3) {
                console.error('[backfill] 3 consecutive batch errors — bailing.');
                process.exit(2);
            }
            await new Promise((r) => setTimeout(r, 2000 * withError));
            continue;
        }
        withError = 0;
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`\n[backfill] done. ${total} recipes embedded in ${elapsed}s.`);

    const { rows } = await pool.query(
        `SELECT count(*) FILTER (WHERE embedding IS NOT NULL)::text AS done,
                count(*)::text AS total
           FROM recipes
          WHERE qa_status NOT IN ('quarantined', 'rejected')`);
    console.log(`[backfill] coverage: ${rows[0].done} / ${rows[0].total} public recipes have embeddings`);

    await pool.end();
}

main().catch((err) => { console.error('[backfill] fatal:', err); process.exit(1); });
