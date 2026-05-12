/**
 * Separate PostgreSQL client for the OFF (Open Food Facts) mirror database.
 *
 * Why separate from Supabase:
 * - The OFF table is ~1.4 GB — too large for Supabase free tier (500 MB limit)
 * - It lives on the VPS alongside the app → sub-millisecond local queries
 * - It has no real-time or auth needs, so Supabase features aren't needed
 * - Supabase remains for core app data: recipes, crawl_jobs, api_keys
 *
 * Set OFF_DB_URL in .env:
 *   OFF_DB_URL=postgresql://user:password@localhost:5432/off_mirror
 *
 * On the VPS, create the database once:
 *   createdb off_mirror
 *   psql off_mirror < supabase/migrations/20260511000001_off_products_table.sql
 *   psql off_mirror < supabase/migrations/20260511000002_off_products_expand_schema.sql
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const OFF_DB_URL = process.env.OFF_DB_URL;

let pool: Pool | null = null;

export function getOffPool(): Pool | null {
    if (!OFF_DB_URL || OFF_DB_URL === '...') return null;
    if (!pool) pool = new Pool({ connectionString: OFF_DB_URL, max: 5 });
    return pool;
}

export interface OffRow {
    code:              string;
    product_name:      string | null;
    brands:            string | null;
    quantity:          string | null;
    calories_100g:     number | null;
    protein_100g:      number | null;
    fat_100g:          number | null;
    carbs_100g:        number | null;
    fiber_100g:        number | null;
    sugar_100g:        number | null;
    sodium_100g:       number | null;
    calcium_100g:      number | null;
    iron_100g:         number | null;
    vitamin_c_100g:    number | null;
    nutriscore_grade:  string | null;
    nova_group:        number | null;
    ecoscore_grade:    string | null;
    ingredients_text:  string | null;
    allergens_tags:    string[] | null;
    traces_tags:       string[] | null;
    additives_tags:    string[] | null;
    labels_tags:       string[] | null;
    categories_tags:   string[] | null;
    image_url:         string | null;
}

/** Barcode lookup — O(log n) index scan, typically <1ms on local Postgres. */
export async function offLookupBarcode(barcode: string): Promise<OffRow | null> {
    const db = getOffPool();
    if (!db) return null;
    try {
        const { rows } = await db.query<OffRow>(
            'SELECT * FROM off_products WHERE code = $1 LIMIT 1',
            [barcode]
        );
        return rows[0] ?? null;
    } catch (e: any) {
        console.warn('OFF barcode lookup error:', e.message);
        return null;
    }
}

/** Full-text search by product name/brand. */
export async function offSearchByName(query: string): Promise<OffRow | null> {
    const db = getOffPool();
    if (!db) return null;
    try {
        const { rows } = await db.query<OffRow>(
            `SELECT * FROM off_products
             WHERE fts @@ websearch_to_tsquery('english', $1)
               AND calories_100g IS NOT NULL
               AND calories_100g > 0
             ORDER BY ts_rank(fts, websearch_to_tsquery('english', $1)) DESC
             LIMIT 1`,
            [query]
        );
        return rows[0] ?? null;
    } catch (e: any) {
        console.warn('OFF name search error:', e.message);
        return null;
    }
}

/**
 * Find products by allergen, label, nova group, or category.
 * Useful for dietary filtering features.
 *
 * Examples:
 *   offFilter({ allergenFree: ['en:gluten', 'en:milk'], maxNova: 2 })
 *   offFilter({ labels: ['en:vegan'], category: 'en:cereals' })
 */
export async function offFilter(opts: {
    allergenFree?: string[];
    labels?:       string[];
    maxNova?:      number;
    category?:     string;
    limit?:        number;
}): Promise<OffRow[]> {
    const db = getOffPool();
    if (!db) return [];

    const conditions: string[] = ['calories_100g IS NOT NULL'];
    const params: any[] = [];
    let p = 1;

    if (opts.allergenFree?.length) {
        // Exclude products that contain any of the listed allergens
        conditions.push(`NOT (allergens_tags && $${p}::text[])`);
        params.push(opts.allergenFree);
        p++;
    }
    if (opts.labels?.length) {
        conditions.push(`labels_tags @> $${p}::text[]`);
        params.push(opts.labels);
        p++;
    }
    if (opts.maxNova != null) {
        conditions.push(`nova_group <= $${p}`);
        params.push(opts.maxNova);
        p++;
    }
    if (opts.category) {
        conditions.push(`$${p} = ANY(categories_tags)`);
        params.push(opts.category);
        p++;
    }

    const limit = opts.limit ?? 50;
    const sql = `SELECT * FROM off_products WHERE ${conditions.join(' AND ')} LIMIT ${limit}`;

    try {
        const { rows } = await db.query<OffRow>(sql, params);
        return rows;
    } catch (e: any) {
        console.warn('OFF filter error:', e.message);
        return [];
    }
}
