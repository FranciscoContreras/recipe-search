#!/usr/bin/env ts-node
/**
 * Restore NDJSON dumps (produced by extract_supabase_rest.ts) into the
 * self-hosted recipe_base. Skips GENERATED columns (e.g. recipes.fts,
 * recipes.ingredients_flat) so the database recomputes them.
 *
 * Usage:
 *   DATABASE_URL=postgresql://recipe_owner:pw@localhost:5432/recipe_base \
 *     npx ts-node src/scripts/restore_from_ndjson.ts \
 *       --extraction /var/backups/recipe_base/extraction
 *
 * DATABASE_URL must point at a role with INSERT rights on every public
 * table — typically `recipe_owner`. Uses ON CONFLICT DO NOTHING so re-runs
 * are safe.
 */

import dotenv from 'dotenv';
import path from 'path';
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import readline from 'readline';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Tables in the same order as extract_supabase_rest.ts plus their PK column
// (for ON CONFLICT). Order doesn't matter for FK because the current schema
// has no inter-table FKs, but we apply the smaller tables first so a failure
// surfaces fast.
const TABLES = [
    { name: 'api_keys',         pk: 'id' },
    { name: 'off_products',     pk: 'code' },
    { name: 'frida_foods',      pk: 'food_id' },
    { name: 'ausnut_foods',     pk: 'food_id' },
    { name: 'cnf_foods',        pk: 'food_code' },
    { name: 'ingredient_cache', pk: 'term' },
    { name: 'crawl_jobs',       pk: 'id' },
    { name: 'recipes',          pk: 'id' },
] as const;

const BATCH_SIZE = 200;

interface CliArgs {
    extractionDir: string;
}

function parseArgs(argv: string[]): CliArgs {
    let dir = '/var/backups/recipe_base/extraction';
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--extraction' || a === '-e') dir = argv[++i];
        else if (a === '--help' || a === '-h') {
            console.log('Usage: restore_from_ndjson [--extraction <dir>]');
            process.exit(0);
        }
    }
    return { extractionDir: path.resolve(dir) };
}

interface ColumnInfo {
    name:      string;
    dataType:  string;  // information_schema.columns.data_type, e.g. 'jsonb', 'ARRAY', 'text', 'uuid'
    udtName:   string;  // pg-internal type, e.g. '_text' for text[], 'jsonb', 'uuid'
}

async function nonGeneratedColumns(client: Client, table: string): Promise<ColumnInfo[]> {
    const { rows } = await client.query<{ column_name: string; data_type: string; udt_name: string }>(`
        SELECT column_name, data_type, udt_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = $1
           AND COALESCE(is_generated, 'NEVER') <> 'ALWAYS'
         ORDER BY ordinal_position
    `, [table]);
    return rows.map((r) => ({ name: r.column_name, dataType: r.data_type, udtName: r.udt_name }));
}

// Encode a JS value into the form pg's parameterized query expects, given
// the target column type.
//   - jsonb / json columns: stringify objects/arrays so Postgres parses the
//     text as JSON (driver otherwise sends JS arrays as Postgres arrays).
//   - ARRAY columns (text[], etc.): pass JS arrays directly; the driver
//     emits the right Postgres array literal.
//   - everything else: pass-through.
function encodeValue(v: unknown, col: ColumnInfo): unknown {
    if (v === null || v === undefined) return null;
    if (col.dataType === 'jsonb' || col.dataType === 'json') {
        return typeof v === 'string' ? v : JSON.stringify(v);
    }
    return v;
}

async function insertBatch(
    client: Client,
    table: string,
    pk: string,
    columns: ColumnInfo[],
    rows: any[],
): Promise<void> {
    if (rows.length === 0) return;

    // Build VALUES placeholders and a flat param array, with explicit casts
    // for jsonb columns so Postgres knows the text we're sending is JSON.
    const params: any[] = [];
    const valuesSql: string[] = [];
    for (const row of rows) {
        const placeholders: string[] = [];
        for (const col of columns) {
            params.push(encodeValue(row[col.name], col));
            const cast = (col.dataType === 'jsonb' || col.dataType === 'json') ? '::jsonb' : '';
            placeholders.push(`$${params.length}${cast}`);
        }
        valuesSql.push(`(${placeholders.join(',')})`);
    }

    const colList = columns.map((c) => `"${c.name}"`).join(',');
    // ON CONFLICT DO NOTHING (no target) catches conflicts on ANY unique
    // constraint — important because api_keys has a unique partial index on
    // (owner_email) WHERE is_active, and the demo-key migration pre-populates
    // a row that would otherwise collide.
    void pk;
    const sql = `
        INSERT INTO "${table}" (${colList})
        VALUES ${valuesSql.join(',')}
        ON CONFLICT DO NOTHING
    `;
    await client.query(sql, params);
}

async function restoreTable(
    client: Client,
    extractionDir: string,
    table: string,
    pk: string,
): Promise<{ table: string; inserted: number; readFromFile: number }> {
    const file = path.join(extractionDir, `${table}.ndjson`);

    // Confirm file exists.
    try { await fs.stat(file); }
    catch { console.log(`  ${table}: SKIP (no file)`); return { table, inserted: 0, readFromFile: 0 }; }

    const columns = await nonGeneratedColumns(client, table);
    if (columns.length === 0) {
        console.log(`  ${table}: SKIP (no columns found — table missing?)`);
        return { table, inserted: 0, readFromFile: 0 };
    }

    const before = (await client.query<{ c: string }>(`SELECT count(*)::text AS c FROM "${table}"`)).rows[0].c;

    const rl = readline.createInterface({
        input: createReadStream(file, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    let buffer: any[] = [];
    let readCount = 0;

    for await (const line of rl) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        buffer.push(row);
        readCount++;
        if (buffer.length >= BATCH_SIZE) {
            await insertBatch(client, table, pk, columns, buffer);
            buffer = [];
            process.stdout.write(`  ${table}: ${readCount} read\r`);
        }
    }
    if (buffer.length > 0) {
        await insertBatch(client, table, pk, columns, buffer);
    }

    const after = (await client.query<{ c: string }>(`SELECT count(*)::text AS c FROM "${table}"`)).rows[0].c;
    const inserted = Number(after) - Number(before);
    console.log(`  ${table}: read ${readCount}, inserted ${inserted} (table now ${after})`);
    return { table, inserted, readFromFile: readCount };
}

async function main(): Promise<void> {
    const args         = parseArgs(process.argv);
    const DATABASE_URL = process.env.DATABASE_URL;
    if (!DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(1); }

    console.log(`[restore] source: ${args.extractionDir}`);
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
        const results: { table: string; inserted: number; readFromFile: number }[] = [];
        for (const { name, pk } of TABLES) {
            console.log(`[restore] ${name}…`);
            results.push(await restoreTable(client, args.extractionDir, name, pk));
        }
        console.log('\n[restore] summary:');
        for (const r of results) console.log(`  ${r.table.padEnd(20)} read ${String(r.readFromFile).padStart(6)}  inserted ${r.inserted}`);
    } finally {
        await client.end();
    }
}

main().catch((err) => { console.error('[restore] fatal:', err); process.exit(1); });
