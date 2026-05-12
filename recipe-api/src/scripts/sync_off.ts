#!/usr/bin/env ts-node
/**
 * Open Food Facts sync — downloads the full product database and imports it
 * into a local PostgreSQL database on the server.
 *
 * Usage:
 *   node dist/scripts/sync_off.js full            # First-time full import (~15 min)
 *   node dist/scripts/sync_off.js delta           # Apply last 7 days of changes
 *   node dist/scripts/sync_off.js delta --days 14
 *
 * Requires OFF_DB_URL in .env:
 *   OFF_DB_URL=postgresql://off_user:off_mirror_2026@localhost:5432/off_mirror
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import https from 'https';
import zlib from 'zlib';
import readline from 'readline';
import { Pool, PoolClient } from 'pg';

const OFF_DB_URL = process.env.OFF_DB_URL;
if (!OFF_DB_URL) {
    console.error('❌  OFF_DB_URL is required in .env');
    console.error('    OFF_DB_URL=postgresql://off_user:off_mirror_2026@localhost:5432/off_mirror');
    process.exit(1);
}

const pool = new Pool({ connectionString: OFF_DB_URL, max: 3 });

const FULL_CSV_URL   = 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz';
const DELTA_INDEX    = 'https://static.openfoodfacts.org/data/delta/index.txt';
const DELTA_BASE_URL = 'https://static.openfoodfacts.org/data/delta/';
const BATCH_SIZE     = 1000; // rows per INSERT batch

const COLS = {
    code: 'code', product_name: 'product_name', brands: 'brands', quantity: 'quantity',
    cal: 'energy-kcal_100g', protein: 'proteins_100g', fat: 'fat_100g',
    carbs: 'carbohydrates_100g', fiber: 'fiber_100g', sugar: 'sugars_100g',
    sodium: 'sodium_100g', calcium: 'calcium_100g', iron: 'iron_100g',
    vitamin_c: 'vitamin-c_100g', nutriscore: 'nutriscore_grade',
    nova_group: 'nova_group',        ecoscore: 'ecoscore_grade',
    ingredients_text: 'ingredients_text', allergens_tags: 'allergens',
    traces_tags: 'traces_tags', additives_tags: 'additives_tags',
    labels_tags: 'labels_tags', categories_tags: 'categories_tags',
    image_url: 'image_url', last_mod: 'last_modified_t',
};

const f   = (v: string)  => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const arr = (v: string)  => { if (!v?.trim()) return null; const t = v.split(',').map(s => s.trim()).filter(Boolean); return t.length ? t : null; };
const nova = (v: string) => { const m = v?.match(/en:(\d)/); return m ? parseInt(m[1]) : null; };
const gr  = (v: string)  => { const g = v?.toLowerCase().trim().slice(0,1); return g && /[a-e]/.test(g) ? g : null; };

// Build one row array from CSV headers + values
function csvToRow(idx: Record<string, number>, vals: string[]): any[] | null {
    const get = (col: string) => vals[idx[col]] ?? '';
    const code = get(COLS.code).trim();
    if (!code || code.length < 4) return null;
    const cal = f(get(COLS.cal));
    if (cal === null) return null;

    return [
        code,
        get(COLS.product_name).slice(0, 500) || null,
        get(COLS.brands).slice(0, 200)       || null,
        get(COLS.quantity).slice(0, 50)      || null,
        cal,
        f(get(COLS.protein)), f(get(COLS.fat)),   f(get(COLS.carbs)),
        f(get(COLS.fiber)),   f(get(COLS.sugar)),  f(get(COLS.sodium)),
        f(get(COLS.calcium))  != null ? f(get(COLS.calcium))!  * 1000 : null,
        f(get(COLS.iron))     != null ? f(get(COLS.iron))!     * 1000 : null,
        f(get(COLS.vitamin_c))!= null ? f(get(COLS.vitamin_c))!* 1000 : null,
        gr(get(COLS.nutriscore)),
        nova(get(COLS.nova_group)),
        gr(get(COLS.ecoscore)),
        get(COLS.ingredients_text).slice(0, 2000) || null,
        arr(get(COLS.allergens_tags)),
        arr(get(COLS.traces_tags)),
        arr(get(COLS.additives_tags)),
        arr(get(COLS.labels_tags)),
        arr(get(COLS.categories_tags)),
        get(COLS.image_url).slice(0, 500) || null,
        parseInt(get(COLS.last_mod)) || null,
    ];
}

// Build one row array from JSONL delta object
function jsonToRow(obj: any): any[] | null {
    if (!obj.code) return null;
    const n   = obj.nutriments ?? {};
    const cal = parseFloat(n['energy-kcal_100g'] ?? n['energy_100g'] ?? 'NaN');
    if (isNaN(cal)) return null;
    const toArr = (v: any): string[] | null =>
        Array.isArray(v) ? (v.length ? v : null) : (typeof v === 'string' ? arr(v) : null);
    return [
        String(obj.code).trim(),
        (obj.product_name ?? '').slice(0, 500) || null,
        (obj.brands ?? '').slice(0, 200)       || null,
        (obj.quantity ?? '').slice(0, 50)      || null,
        cal,
        parseFloat(n['proteins_100g'])      || null, parseFloat(n['fat_100g'])           || null,
        parseFloat(n['carbohydrates_100g']) || null, parseFloat(n['fiber_100g'])          || null,
        parseFloat(n['sugars_100g'])        || null, parseFloat(n['sodium_100g'])         || null,
        n['calcium_100g']  ? parseFloat(n['calcium_100g'])  * 1000 : null,
        n['iron_100g']      ? parseFloat(n['iron_100g'])     * 1000 : null,
        n['vitamin-c_100g'] ? parseFloat(n['vitamin-c_100g'])* 1000 : null,
        gr(obj.nutriscore_grade),
        typeof obj.nova_group === 'number' ? obj.nova_group : null,
        gr(obj.ecoscore_grade),
        (obj.ingredients_text ?? '').slice(0, 2000) || null,
        toArr(obj.allergens_tags), toArr(obj.traces_tags), toArr(obj.additives_tags),
        toArr(obj.labels_tags),    toArr(obj.categories_tags),
        (obj.image_url ?? '').slice(0, 500) || null,
        obj.last_modified_t || null,
    ];
}

const COLUMNS = `code,product_name,brands,quantity,
    calories_100g,protein_100g,fat_100g,carbs_100g,fiber_100g,sugar_100g,
    sodium_100g,calcium_100g,iron_100g,vitamin_c_100g,
    nutriscore_grade,nova_group,ecoscore_grade,ingredients_text,
    allergens_tags,traces_tags,additives_tags,labels_tags,categories_tags,
    image_url,last_modified_t`;

async function flushInsert(client: PoolClient, rows: any[][]): Promise<number> {
    if (!rows.length) return 0;
    const PER_ROW = 25; // columns per row
    let params: any[] = [];
    const chunks: string[][] = [];
    for (let i = 0; i < rows.length; i++) {
        const placeholders = rows[i].map((_, j) => `$${i * PER_ROW + j + 1}`);
        chunks.push(placeholders);
        params = params.concat(rows[i]);
    }
    const sql = `INSERT INTO off_products(${COLUMNS},synced_at)
                 VALUES ${chunks.map(p => `(${p.join(',')},now())`).join(',')}
                 ON CONFLICT(code) DO UPDATE SET
                   product_name=EXCLUDED.product_name, brands=EXCLUDED.brands,
                   calories_100g=EXCLUDED.calories_100g, protein_100g=EXCLUDED.protein_100g,
                   fat_100g=EXCLUDED.fat_100g, carbs_100g=EXCLUDED.carbs_100g,
                   fiber_100g=EXCLUDED.fiber_100g, nova_group=EXCLUDED.nova_group,
                   nutriscore_grade=EXCLUDED.nutriscore_grade, ecoscore_grade=EXCLUDED.ecoscore_grade,
                   allergens_tags=EXCLUDED.allergens_tags, labels_tags=EXCLUDED.labels_tags,
                   ingredients_text=EXCLUDED.ingredients_text,
                   last_modified_t=EXCLUDED.last_modified_t, synced_at=now()`;
    await client.query(sql, params);
    return rows.length;
}

// Fetch a URL, following up to 5 redirects, and return the IncomingMessage stream
function fetchFollowRedirects(url: string, redirectsLeft = 5): Promise<import('http').IncomingMessage> {
    return new Promise((resolve, reject) => {
        const module = url.startsWith('https') ? https : require('http');
        module.get(url, { headers: { 'User-Agent': 'RecipeBaseSync/1.0' } }, (res: any) => {
            if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308)
                && res.headers.location && redirectsLeft > 0) {
                res.resume(); // drain the redirect body
                resolve(fetchFollowRedirects(res.headers.location, redirectsLeft - 1));
            } else if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            } else {
                resolve(res);
            }
        }).on('error', reject);
    });
}

// Stream a gzipped URL line by line, following redirects
async function* gzipLines(url: string): AsyncGenerator<string> {
    const queue: string[] = [];
    let done     = false;
    let waiting: ((v: IteratorResult<string, any>) => void) | null = null;

    const res = await fetchFollowRedirects(url);
    const rl  = readline.createInterface({ input: res.pipe(zlib.createGunzip()), crlfDelay: Infinity });

    rl.on('line', line => {
        if (waiting) { const w = waiting; waiting = null; w({ value: line, done: false }); }
        else queue.push(line);
    });
    rl.on('close', () => {
        done = true;
        if (waiting) waiting({ value: '' as any, done: true });
    });
    rl.on('error', (e) => { if (waiting) waiting({ value: '' as any, done: true }); console.error('rl error:', e.message); });

    while (true) {
        if (queue.length) { yield queue.shift()!; continue; }
        if (done)         break;
        yield await new Promise<string>(r => { waiting = (v) => r(v.value as string); });
    }
}

// ─── FULL IMPORT ─────────────────────────────────────────────────────────────

async function runFull() {
    console.log('📥  Starting full OFF import...');
    console.log(`    Source: ${FULL_CSV_URL}`);
    console.log('    Streaming and importing ~1.5M nutrition-complete products.\n');

    const client = await pool.connect();
    try {
        // Drop FTS generated column before bulk insert (rebuild after — much faster)
        await client.query('ALTER TABLE off_products DROP COLUMN IF EXISTS fts');
        await client.query('TRUNCATE TABLE off_products');
        console.log('    Table cleared. Starting stream...');

        let headers: string[] = [];
        let idx: Record<string, number> = {};
        let lineNum  = 0;
        let inserted = 0;
        let skipped  = 0;
        let batch: any[][] = [];

        for await (const line of gzipLines(FULL_CSV_URL)) {
            lineNum++;
            if (lineNum === 1) {
                headers = line.split('\t');
                headers.forEach((h, i) => { idx[h] = i; });
                console.log(`    CSV has ${headers.length} columns.`);
                continue;
            }

            const row = csvToRow(idx, line.split('\t'));
            if (!row) { skipped++; continue; }

            batch.push(row);
            if (batch.length >= BATCH_SIZE) {
                inserted += await flushInsert(client, batch);
                batch = [];
                if (inserted % 100000 === 0) {
                    process.stdout.write(`\r    Inserted: ${inserted.toLocaleString()}  Skipped: ${skipped.toLocaleString()}  Line: ${lineNum.toLocaleString()}`);
                }
            }
        }
        if (batch.length) inserted += await flushInsert(client, batch);

        console.log(`\n\n    Building FTS index...`);
        await client.query(`
            ALTER TABLE off_products ADD COLUMN fts tsvector
                GENERATED ALWAYS AS (
                    to_tsvector('english', coalesce(product_name,'') || ' ' || coalesce(brands,''))
                ) STORED
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS off_products_fts_idx ON off_products USING GIN(fts)`);

        console.log(`\n✅  Import complete!`);
        console.log(`    Inserted: ${inserted.toLocaleString()} products`);
        console.log(`    Skipped (no calorie data): ${skipped.toLocaleString()} products`);

        const { rows } = await client.query('SELECT count(*) FROM off_products');
        console.log(`    Total in DB: ${parseInt(rows[0].count).toLocaleString()}`);
    } finally {
        client.release();
    }
}

// ─── DELTA SYNC ──────────────────────────────────────────────────────────────

async function runDelta(days = 7) {
    console.log(`📥  Fetching OFF delta files (last ${days} days)...`);
    const indexRes = await fetch(DELTA_INDEX);
    if (!indexRes.ok) { console.error('Failed to fetch delta index:', indexRes.status); process.exit(1); }

    const cutoff     = Math.floor(Date.now() / 1000) - days * 86400;
    const deltaFiles = (await indexRes.text()).trim().split('\n')
        .filter(Boolean)
        .filter(f => { const m = f.match(/(\d+)_(\d+)/); return m && parseInt(m[2]) >= cutoff; })
        .sort();

    if (!deltaFiles.length) { console.log('No new delta files.'); return; }
    console.log(`    Found ${deltaFiles.length} file(s).\n`);

    const client     = await pool.connect();
    let totalUpserted = 0;
    try {
        for (const filename of deltaFiles) {
            process.stdout.write(`  Processing: ${filename} ... `);
            let batch: any[][] = [];
            let count = 0;
            for await (const line of gzipLines(DELTA_BASE_URL + filename)) {
                if (!line.trim()) continue;
                try {
                    const row = jsonToRow(JSON.parse(line));
                    if (!row) continue;
                    batch.push(row);
                    if (batch.length >= BATCH_SIZE) { count += await flushInsert(client, batch); batch = []; }
                } catch { /* skip malformed */ }
            }
            if (batch.length) count += await flushInsert(client, batch);
            console.log(`${count.toLocaleString()} upserted`);
            totalUpserted += count;
        }
    } finally {
        client.release();
    }
    console.log(`\n✅  Delta complete. Total: ${totalUpserted.toLocaleString()}`);
}

// ─── Entry ────────────────────────────────────────────────────────────────────
const mode = process.argv[2];
const dIdx = process.argv.indexOf('--days');
const days = dIdx >= 0 ? parseInt(process.argv[dIdx + 1]) || 7 : 7;

if (mode === 'full')       runFull().then(() => pool.end()).catch(e => { console.error(e); process.exit(1); });
else if (mode === 'delta') runDelta(days).then(() => pool.end()).catch(e => { console.error(e); process.exit(1); });
else { console.log('Usage: sync_off.ts full | delta [--days N]'); process.exit(0); }
