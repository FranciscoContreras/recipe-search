#!/usr/bin/env ts-node
/**
 * Extract every row from every public table on Supabase via the REST endpoint,
 * writing one NDJSON file per table to `--output` (default `./extraction`).
 *
 * Used as Path B of the data extraction in the self-host-postgres migration
 * — runs even if direct Postgres port is blocked.
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=ey... \
 *     npx ts-node src/scripts/extract_supabase_rest.ts [--output ./extraction]
 *
 * Writes:
 *   ./extraction/<table>.ndjson   (one JSON object per line)
 *   ./extraction/manifest.json    (per-table row count + timestamp)
 */

import dotenv from 'dotenv';
import path from 'path';
import { promises as fs, createWriteStream, WriteStream } from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ─── Config ──────────────────────────────────────────────────────────────────

// PostgREST requires the order column to exist on the target table.
// Each entry pairs a table with a stable PK-based ordering so the dump is
// deterministic (matters for verify_migration.ts SHA-256 comparison).
const TABLES = [
    { name: 'recipes',          order: 'id.asc' },
    { name: 'crawl_jobs',       order: 'created_at.asc,id.asc' },
    { name: 'ingredient_cache', order: 'term.asc' },        // PK is `term`
    { name: 'off_products',     order: 'code.asc' },        // PK is `code`
    { name: 'cnf_foods',        order: 'food_code.asc' },   // PK is `food_code`
    { name: 'frida_foods',      order: 'food_id.asc' },     // PK is `food_id`
    { name: 'ausnut_foods',     order: 'food_id.asc' },     // PK is `food_id`
    { name: 'api_keys',         order: 'created_at.asc,id.asc' },
] as const;

const PAGE_SIZE      = 1000;
const MAX_RETRIES    = 3;
const BASE_BACKOFF_MS = 1_000;

interface CliArgs {
    output: string;
}

function parseArgs(argv: string[]): CliArgs {
    let output = './extraction';
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--output' || a === '-o') {
            output = argv[++i];
        } else if (a === '--help' || a === '-h') {
            console.log('Usage: extract_supabase_rest [--output <dir>]');
            process.exit(0);
        }
    }
    return { output: path.resolve(output) };
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

interface PageResult {
    rows:        unknown[];
    totalCount:  number | null; // from Content-Range header
    fullEnd:     number;        // 0-based end of returned range
}

async function fetchPage(
    baseUrl: string,
    table:   string,
    apiKey:  string,
    from:    number,
    to:      number,
    order:   string,
): Promise<PageResult> {
    const url = `${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=*&order=${encodeURIComponent(order)}`;

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(url, {
                headers: {
                    'apikey':        apiKey,
                    'Authorization': `Bearer ${apiKey}`,
                    'Range-Unit':    'items',
                    'Range':         `${from}-${to}`,
                    'Prefer':        'count=exact',
                },
            });

            if (!res.ok) {
                // Retry on 4xx (other than 416) and 5xx — the suspended project's
                // gateway can return transient 502/503 even when reads are allowed.
                if (res.status === 416) {
                    // "Range not satisfiable" — we asked past the end of the table.
                    return { rows: [], totalCount: extractTotal(res.headers.get('content-range')), fullEnd: from - 1 };
                }
                throw new Error(`HTTP ${res.status} ${res.statusText}: ${await res.text()}`);
            }

            const rows  = await res.json() as unknown[];
            const range = res.headers.get('content-range');
            const total = extractTotal(range);
            const end   = extractEnd(range, from + rows.length - 1);
            return { rows, totalCount: total, fullEnd: end };
        } catch (err) {
            lastErr = err;
            if (attempt < MAX_RETRIES) {
                const wait = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
                console.warn(`[extract] ${table} ${from}-${to} failed (attempt ${attempt}/${MAX_RETRIES}) — retrying in ${wait}ms`);
                await sleep(wait);
            }
        }
    }
    throw new Error(`[extract] ${table} ${from}-${to} permanently failed: ${(lastErr as Error)?.message ?? lastErr}`);
}

/** Parse "0-999/12345" → 12345. */
function extractTotal(header: string | null): number | null {
    if (!header) return null;
    const slash = header.lastIndexOf('/');
    if (slash < 0) return null;
    const tail = header.slice(slash + 1).trim();
    if (tail === '*' || tail === '') return null;
    const n = parseInt(tail, 10);
    return Number.isFinite(n) ? n : null;
}

/** Parse "0-999/12345" → 999. */
function extractEnd(header: string | null, fallback: number): number {
    if (!header) return fallback;
    const slash = header.indexOf('/');
    const range = slash >= 0 ? header.slice(0, slash) : header;
    const dash  = range.indexOf('-');
    if (dash < 0) return fallback;
    const n = parseInt(range.slice(dash + 1), 10);
    return Number.isFinite(n) ? n : fallback;
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

// ─── Stream-write helper ─────────────────────────────────────────────────────

function writeLine(stream: WriteStream, obj: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
        const ok = stream.write(JSON.stringify(obj) + '\n', (err) => {
            if (err) reject(err);
        });
        if (ok) resolve();
        else    stream.once('drain', resolve);
    });
}

// ─── Per-table extraction ────────────────────────────────────────────────────

interface TableSummary {
    table:        string;
    rowCount:     number;
    declaredTotal: number | null;
    file:         string;
}

async function extractTable(
    baseUrl: string,
    apiKey:  string,
    table:   string,
    order:   string,
    outDir:  string,
): Promise<TableSummary> {
    const file   = path.join(outDir, `${table}.ndjson`);
    const stream = createWriteStream(file, { encoding: 'utf8' });

    let from        = 0;
    let total       = 0;
    let declared: number | null = null;

    try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const to   = from + PAGE_SIZE - 1;
            const page = await fetchPage(baseUrl, table, apiKey, from, to, order);

            if (declared === null && page.totalCount !== null) declared = page.totalCount;

            for (const row of page.rows) {
                // eslint-disable-next-line no-await-in-loop
                await writeLine(stream, row);
            }
            total += page.rows.length;

            // Stop conditions: empty page OR short page (less than asked)
            if (page.rows.length === 0) break;
            if (page.rows.length < PAGE_SIZE) break;
            // Or we've reached the declared total
            if (declared !== null && total >= declared) break;

            from += PAGE_SIZE;
            // Polite pacing — the suspended project's rate limits are unknown
            await sleep(50);
            process.stdout.write(`  ${table}: ${total}${declared !== null ? ` / ${declared}` : ''}\r`);
        }
    } finally {
        await new Promise<void>((resolve, reject) => {
            stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
        });
    }

    console.log(`  ${table}: ${total} rows -> ${path.relative(process.cwd(), file)}`);
    return { table, rowCount: total, declaredTotal: declared, file: path.basename(file) };
}

// ─── Entrypoint ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const args = parseArgs(process.argv);

    const SUPABASE_URL          = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
        console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
        process.exit(1);
    }

    await fs.mkdir(args.output, { recursive: true });
    console.log(`[extract] writing to ${args.output}`);
    console.log(`[extract] source: ${SUPABASE_URL}`);

    const summaries: TableSummary[] = [];
    for (const { name, order } of TABLES) {
        console.log(`[extract] ${name}…`);
        try {
            const s = await extractTable(SUPABASE_URL, SUPABASE_SERVICE_ROLE, name, order, args.output);
            summaries.push(s);
        } catch (err: any) {
            console.error(`[extract] ${name} FAILED: ${err.message}`);
            summaries.push({ table: name, rowCount: 0, declaredTotal: null, file: `${name}.ndjson`, ...{ error: err.message } as object });
        }
    }

    const manifest = {
        extracted_at: new Date().toISOString(),
        source:       SUPABASE_URL,
        tables:       summaries,
    };
    const manifestPath = path.join(args.output, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`[extract] manifest -> ${path.relative(process.cwd(), manifestPath)}`);

    const failed = summaries.filter((s) => (s as any).error);
    if (failed.length > 0) process.exit(2);
}

main().catch((err) => {
    console.error('[extract] fatal:', err);
    process.exit(1);
});
