#!/usr/bin/env ts-node
/**
 * Per-table verification of the Supabase → self-hosted Postgres migration.
 *
 * For each table, computes a SHA-256 over a deterministic CSV rendering of
 * all rows (sorted by primary key), compared between source and target.
 * Counts must match too.
 *
 * Two source modes:
 *   --source ./extraction          NDJSON files written by extract_supabase_rest.ts
 *   --source rest                  Live REST endpoint (uses SUPABASE_URL + SERVICE_ROLE_KEY)
 *
 * Target is always the Postgres at $DATABASE_URL (the new self-hosted DB).
 *
 * Usage:
 *   npx ts-node src/scripts/verify_migration.ts --source ./extraction \
 *       --target "postgresql://recipe_app:pw@localhost:5432/recipe_base"
 *
 * Note: this script renders rows to CSV in TypeScript on BOTH sides to keep the
 * hashes byte-identical. We deliberately do NOT use pg's COPY ... TO STDOUT for
 * the target side because Supabase REST doesn't have a COPY equivalent, so a
 * column-list-driven SELECT path is the only way to guarantee identical output.
 */

import dotenv from 'dotenv';
import path from 'path';
import { promises as fs, createReadStream } from 'fs';
import readline from 'readline';
import { createHash, Hash } from 'crypto';
import { Pool, PoolClient } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ─── Config ──────────────────────────────────────────────────────────────────

/**
 * Per-table list of columns + primary-key columns.
 * Order MUST be deterministic across runs — alphabetic on column name keeps it stable.
 */
interface TableSpec {
    name:    string;
    pk:      string[];
    columns: string[];
}

const TABLES: TableSpec[] = [
    {
        name: 'recipes',
        pk:   ['id'],
        columns: [
            'audit_log', 'cook_time', 'created_at', 'description', 'id',
            'image', 'ingredients_flat', 'last_audited_at', 'name', 'nutrition',
            'prep_time', 'qa_status', 'quality_score',
            'recipe_category', 'recipe_cuisine', 'recipe_ingredients',
            'recipe_instructions', 'recipe_yield', 'total_time', 'updated_at', 'url',
        ],
    },
    {
        name: 'crawl_jobs',
        pk:   ['id'],
        columns: [
            'created_at', 'id', 'is_archived', 'log', 'next_retry_at',
            'recipes_found', 'retry_count', 'status', 'updated_at', 'url',
        ],
    },
    {
        name: 'ingredient_cache',
        pk:   ['term'],
        columns: [
            'created_at', 'nutrition', 'remote_id',
            'serving_description', 'serving_grams', 'source', 'term', 'updated_at',
        ],
    },
    {
        name: 'off_products',
        pk:   ['code'],
        columns: [
            'additives_tags', 'allergens_tags', 'brands', 'calcium_100g',
            'calories_100g', 'carbs_100g', 'categories_tags', 'code',
            'ecoscore_grade', 'fat_100g', 'fiber_100g', 'image_url',
            'ingredients_text', 'iron_100g', 'labels_tags', 'last_modified_t',
            'nova_group', 'nutriscore_grade', 'product_name', 'protein_100g',
            'quantity', 'sodium_100g', 'sugar_100g', 'synced_at', 'traces_tags',
            'vitamin_c_100g',
        ],
    },
    {
        name: 'cnf_foods',
        pk:   ['food_code'],
        columns: [
            'calories_100g', 'carbs_100g', 'fat_100g', 'fiber_100g',
            'food_code', 'food_name', 'protein_100g',
            'serving_description', 'serving_grams', 'sugar_100g',
        ],
    },
    {
        name: 'frida_foods',
        pk:   ['food_id'],
        columns: [
            'calories_100g', 'carbs_100g', 'fat_100g', 'fiber_100g',
            'food_id', 'food_name', 'food_name_da', 'preparation', 'protein_100g',
            'serving_description', 'serving_grams', 'sugar_100g',
        ],
    },
    {
        name: 'ausnut_foods',
        pk:   ['food_id'],
        columns: [
            'calories_100g', 'carbs_100g', 'fat_100g', 'fiber_100g',
            'food_group', 'food_id', 'food_name', 'protein_100g',
            'serving_description', 'serving_grams', 'sodium_100g', 'sugar_100g',
        ],
    },
    {
        name: 'api_keys',
        pk:   ['id'],
        columns: [
            'created_at', 'expires_at', 'id', 'is_active', 'key_hash',
            'last_used_at', 'owner_email', 'owner_name',
        ],
    },
];

interface CliArgs {
    sourceMode: 'ndjson' | 'rest';
    sourceDir:  string | null;
    targetUrl:  string;
}

function parseArgs(argv: string[]): CliArgs {
    let source: string  = './extraction';
    let target: string | null = null;
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--source' || a === '-s') source = argv[++i];
        else if (a === '--target' || a === '-t') target = argv[++i];
        else if (a === '--help' || a === '-h') {
            console.log('Usage: verify_migration --source <dir|rest> --target <pg-url>');
            process.exit(0);
        }
    }
    const targetUrl = target || process.env.DATABASE_URL;
    if (!targetUrl) {
        console.error('Missing --target (or set DATABASE_URL).');
        process.exit(1);
    }
    const sourceMode: 'ndjson' | 'rest' = source === 'rest' ? 'rest' : 'ndjson';
    const sourceDir   = sourceMode === 'ndjson' ? path.resolve(source) : null;
    return { sourceMode, sourceDir, targetUrl };
}

// ─── CSV rendering (deterministic) ───────────────────────────────────────────

/**
 * Render a single value to CSV per RFC-4180:
 *  - null/undefined  → empty string
 *  - boolean         → "true"/"false"
 *  - number          → JSON.stringify(n) (handles -0 / Infinity sanity)
 *  - string          → quoted if needed (contains , " \n \r), inner " doubled
 *  - Date            → ISO 8601 string
 *  - array/object    → JSON.stringify with stable key order
 */
function csvField(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean')        return v ? 'true' : 'false';
    if (typeof v === 'number')         return Number.isFinite(v) ? String(v) : '';
    if (v instanceof Date)             return v.toISOString();
    if (typeof v === 'string')         return quoteCsv(v);
    // arrays + objects (JSONB columns + Postgres array columns)
    return quoteCsv(JSON.stringify(sortKeys(v)));
}

function quoteCsv(s: string): string {
    if (/[",\n\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

/** Recursively sort object keys for stable JSON output. */
function sortKeys(v: unknown): unknown {
    if (Array.isArray(v))                              return v.map(sortKeys);
    if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(v as object).sort()) {
            out[k] = sortKeys((v as Record<string, unknown>)[k]);
        }
        return out;
    }
    return v;
}

function rowToCsvLine(spec: TableSpec, row: Record<string, unknown>): string {
    return spec.columns.map((c) => csvField(row[c])).join(',') + '\n';
}

// ─── Source A: NDJSON file ───────────────────────────────────────────────────

async function hashNdjson(spec: TableSpec, file: string): Promise<{ count: number; sha256: string }> {
    // Two-pass: load → sort → hash. Reasonable for ≤ 25k rows per table.
    // For very large tables a chunked external sort would be needed.
    const rows: Record<string, unknown>[] = [];
    const rl = readline.createInterface({
        input: createReadStream(file, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });
    for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        rows.push(JSON.parse(trimmed));
    }
    rows.sort((a, b) => comparePk(spec, a, b));

    const h = createHash('sha256');
    h.update(`${spec.columns.join(',')}\n`); // header line for stability
    for (const row of rows) h.update(rowToCsvLine(spec, row));
    return { count: rows.length, sha256: h.digest('hex') };
}

function comparePk(spec: TableSpec, a: Record<string, unknown>, b: Record<string, unknown>): number {
    for (const k of spec.pk) {
        const av = a[k];
        const bv = b[k];
        if (av === bv) continue;
        if (av === null || av === undefined) return -1;
        if (bv === null || bv === undefined) return  1;
        if (typeof av === 'number' && typeof bv === 'number') return av - bv;
        return String(av) < String(bv) ? -1 : 1;
    }
    return 0;
}

// ─── Source B: live REST ────────────────────────────────────────────────────

async function hashViaRest(spec: TableSpec, baseUrl: string, apiKey: string): Promise<{ count: number; sha256: string }> {
    const pageSize = 1000;
    let from = 0;
    const rows: Record<string, unknown>[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const to  = from + pageSize - 1;
        const url = `${baseUrl}/rest/v1/${encodeURIComponent(spec.name)}?select=*&order=${spec.pk.map((c) => `${c}.asc`).join(',')}`;
        const res = await fetch(url, {
            headers: {
                'apikey':        apiKey,
                'Authorization': `Bearer ${apiKey}`,
                'Range-Unit':    'items',
                'Range':         `${from}-${to}`,
            },
        });
        if (!res.ok && res.status !== 416) {
            throw new Error(`REST ${spec.name} ${from}-${to}: HTTP ${res.status}: ${await res.text()}`);
        }
        const batch = res.status === 416 ? [] : (await res.json() as Record<string, unknown>[]);
        rows.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
    }
    rows.sort((a, b) => comparePk(spec, a, b));
    const h = createHash('sha256');
    h.update(`${spec.columns.join(',')}\n`);
    for (const row of rows) h.update(rowToCsvLine(spec, row));
    return { count: rows.length, sha256: h.digest('hex') };
}

// ─── Target: Postgres ────────────────────────────────────────────────────────

async function hashTargetTable(spec: TableSpec, pool: Pool): Promise<{ count: number; sha256: string }> {
    // Streaming SELECT with cursor for memory safety on large tables.
    // We use a pg cursor manually via DECLARE/FETCH within a transaction.
    const client: PoolClient = await pool.connect();
    const h    = createHash('sha256');
    let   count = 0;
    h.update(`${spec.columns.join(',')}\n`);

    try {
        await client.query('BEGIN');
        const cur = `verify_cur_${spec.name.replace(/[^a-z0-9_]/gi, '')}_${process.pid}`;
        const colList = spec.columns.join(', ');
        const orderBy = spec.pk.join(', ');
        await client.query(`DECLARE ${cur} CURSOR FOR SELECT ${colList} FROM ${spec.name} ORDER BY ${orderBy} ASC`);
        const FETCH = 1000;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const { rows } = await client.query<Record<string, unknown>>(`FETCH ${FETCH} FROM ${cur}`);
            if (rows.length === 0) break;
            for (const r of rows) {
                h.update(rowToCsvLine(spec, r));
                count++;
            }
            if (rows.length < FETCH) break;
        }
        await client.query(`CLOSE ${cur}`);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
    } finally {
        client.release();
    }

    return { count, sha256: h.digest('hex') };
}

// ─── Entrypoint ──────────────────────────────────────────────────────────────

interface TableResult {
    table:     string;
    source:    { count: number; sha256: string; skipped?: string };
    target:    { count: number; sha256: string; skipped?: string };
    ok:        boolean;
    error?:    string;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv);

    const pool = new Pool({ connectionString: args.targetUrl, max: 4 });

    // REST mode needs SUPABASE_URL + SERVICE_ROLE_KEY in env
    let restBase: string | null = null;
    let restKey:  string | null = null;
    if (args.sourceMode === 'rest') {
        restBase = process.env.SUPABASE_URL ?? null;
        restKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
        if (!restBase || !restKey) {
            console.error('--source rest requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.');
            process.exit(1);
        }
    }

    const results: TableResult[] = [];
    for (const spec of TABLES) {
        process.stdout.write(`[verify] ${spec.name}…`);

        // Source
        let source: { count: number; sha256: string; skipped?: string };
        try {
            if (args.sourceMode === 'ndjson') {
                const file = path.join(args.sourceDir!, `${spec.name}.ndjson`);
                try { await fs.access(file); }
                catch {
                    source = { count: 0, sha256: '', skipped: 'NDJSON missing' };
                    process.stdout.write(` source-skipped (no file)`);
                    // fall through to target hash
                    // but mark mismatch unless target is also empty
                    const target = await hashTargetTable(spec, pool);
                    const ok = target.count === 0;
                    results.push({ table: spec.name, source: source!, target, ok, error: ok ? undefined : 'source NDJSON missing but target non-empty' });
                    process.stdout.write(ok ? ' ok\n' : ' MISMATCH\n');
                    continue;
                }
                source = await hashNdjson(spec, file);
            } else {
                source = await hashViaRest(spec, restBase!, restKey!);
            }
        } catch (err: any) {
            console.log(` source-FAILED: ${err.message}`);
            results.push({
                table: spec.name,
                source: { count: 0, sha256: '', skipped: err.message },
                target: { count: 0, sha256: '' },
                ok: false,
                error: `source: ${err.message}`,
            });
            continue;
        }

        // Target
        let target;
        try {
            target = await hashTargetTable(spec, pool);
        } catch (err: any) {
            console.log(` target-FAILED: ${err.message}`);
            results.push({
                table: spec.name,
                source,
                target: { count: 0, sha256: '', skipped: err.message },
                ok: false,
                error: `target: ${err.message}`,
            });
            continue;
        }

        const ok = source.count === target.count && source.sha256 === target.sha256;
        results.push({ table: spec.name, source, target, ok });
        if (ok) {
            console.log(`  ok  (${source.count} rows, sha=${source.sha256.slice(0, 10)}…)`);
        } else {
            console.log(`  MISMATCH  src=${source.count}/${source.sha256.slice(0, 10)}… tgt=${target.count}/${target.sha256.slice(0, 10)}…`);
        }
    }

    await pool.end();

    // Final report
    const failed = results.filter((r) => !r.ok);
    console.log();
    console.log(`[verify] ${results.length - failed.length}/${results.length} tables match`);
    if (failed.length > 0) {
        console.log('[verify] mismatches:');
        for (const r of failed) {
            console.log(
                `  - ${r.table}: src(count=${r.source.count}, sha=${r.source.sha256.slice(0, 10)}…)`
                + ` tgt(count=${r.target.count}, sha=${r.target.sha256.slice(0, 10)}…)`
                + (r.error ? ` :: ${r.error}` : ''),
            );
        }
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('[verify] fatal:', err);
    process.exit(1);
});
