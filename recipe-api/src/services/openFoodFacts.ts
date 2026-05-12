/**
 * Open Food Facts — packaged product nutrition.
 *
 * Query priority:
 *  1. Local off_products table (Supabase) — populated by sync_off.ts, sub-ms, no 503s
 *  2. Live OFF API  — fallback for products not yet in local mirror
 *
 * The local table is the primary source once sync_off.ts has been run.
 * Run `npx ts-node src/scripts/sync_off.ts full` once, then weekly deltas.
 */

import { supabase } from '../supabaseClient';
import { offLookupBarcode as offVpsBarcode, offSearchByName as offVpsSearch, OffRow } from '../offDbClient';

const BASE_SEARCH  = 'https://world.openfoodfacts.org/cgi/search.pl';
const BASE_BARCODE = 'https://world.openfoodfacts.org/api/v2/product';
const USER_AGENT   = 'RecipeBaseAPI/1.0 (https://recipe-base.wearemachina.com)';

export interface OffNutrition {
    calories:      number;
    protein:       number;
    fat:           number;
    carbs:         number;
    fiber:         number;
    sugar:         number;
    calcium_mg:    number;
    iron_mg:       number;
    vitamin_a_mcg: number;
    vitamin_c_mg:  number;
    serving_size_g: number;
}

// ─── Relevance guard ──────────────────────────────────────────────────────────
//
// Open Food Facts is a packaged-product database. Its text search (FTS) may rank
// a product by keyword overlap without semantic understanding, so "green cabbage"
// can return a coleslaw kit with dressing (~542 kcal/100g) instead of raw cabbage
// (~25 kcal/100g). This function gates every result: at least one significant word
// from the search query must appear in the matched product name.
//
// Examples caught by this guard:
//   query="green cabbage"  product="Cole Slaw Kit"                → REJECT ("cabbage" absent)
//   query="milk"           product="Chocolate Fudge Brownie"      → REJECT ("milk" absent)
//   query="chicken stock"  product="Pretzels, Salted"             → REJECT
//   query="olive oil"      product="Extra Virgin Olive Oil"       → ACCEPT ("olive"/"oil" match)
//
// We intentionally don't reject on calorie density alone (e.g., cream cheese IS
// high-calorie, so a density check would create false positives). Name relevance
// is the reliable signal.

function isRelevantOffResult(productName: string | null | undefined, query: string): boolean {
    if (!productName) return false;
    const nameLower = productName.toLowerCase();
    // Extract words ≥4 chars — shorter words ("oil", "mix") are too ambiguous.
    // We keep 3-char words that are the ENTIRE query (single-word searches like "egg").
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= (query.trim().includes(' ') ? 4 : 3));
    if (queryWords.length === 0) {
        // Fallback: at least the full query is a substring of the name
        return nameLower.includes(query.toLowerCase().trim());
    }
    return queryWords.some(w => nameLower.includes(w));
}

// ─── Local DB helpers ─────────────────────────────────────────────────────────

function offRowToNutrition(row: OffRow | any): OffNutrition {
    return {
        calories:       row.calories_100g  ?? 0,
        protein:        row.protein_100g   ?? 0,
        fat:            row.fat_100g       ?? 0,
        carbs:          row.carbs_100g     ?? 0,
        fiber:          row.fiber_100g     ?? 0,
        sugar:          row.sugar_100g     ?? 0,
        calcium_mg:     row.calcium_100g   ?? 0,
        iron_mg:        row.iron_100g      ?? 0,
        vitamin_a_mcg:  0,                            // OFF CSV doesn't carry vitamin A reliably
        vitamin_c_mg:   row.vitamin_c_100g ?? 0,
        serving_size_g: 100,
    };
}

/** Search local off_products — tries VPS PostgreSQL first, then Supabase. */
async function searchLocal(query: string): Promise<OffNutrition | null> {
    // 1. VPS PostgreSQL (fastest — local socket on the production server)
    const vpsRow = await offVpsSearch(query);
    if (vpsRow && isRelevantOffResult(vpsRow.product_name, query)) {
        return offRowToNutrition(vpsRow);
    }

    // 2. Supabase fallback (if off_products exists there — requires Pro plan)
    const { data, error } = await supabase
        .from('off_products')
        .select('product_name, calories_100g, protein_100g, fat_100g, carbs_100g, fiber_100g, sugar_100g, calcium_100g, iron_100g, vitamin_c_100g')
        .textSearch('fts', query, { type: 'websearch', config: 'english' })
        .not('calories_100g', 'is', null)
        .gt('calories_100g', 0)
        .limit(1)
        .single();

    if (error || !data) return null;
    if (!isRelevantOffResult((data as any).product_name, query)) return null;
    return offRowToNutrition(data);
}

/** Look up by barcode — tries VPS PostgreSQL first, then Supabase. */
async function lookupLocalBarcode(barcode: string): Promise<any | null> {
    // 1. VPS PostgreSQL
    const vpsRow = await offVpsBarcode(barcode);
    if (vpsRow) return vpsRow;

    // 2. Supabase fallback
    const { data, error } = await supabase
        .from('off_products')
        .select('*')
        .eq('code', barcode)
        .single();

    if (error || !data) return null;
    return data;
}

// ─── Live API helpers ─────────────────────────────────────────────────────────

export function extractNutrients(nutriments: any): OffNutrition | null {
    if (!nutriments) return null;

    const cal = parseFloat(nutriments['energy-kcal_100g'] ?? nutriments['energy_100g'] ?? 0);
    if (!cal && cal !== 0) return null;

    return {
        calories:       cal,
        protein:        parseFloat(nutriments['proteins_100g']      ?? 0),
        fat:            parseFloat(nutriments['fat_100g']            ?? 0),
        carbs:          parseFloat(nutriments['carbohydrates_100g']  ?? 0),
        fiber:          parseFloat(nutriments['fiber_100g']          ?? 0),
        sugar:          parseFloat(nutriments['sugars_100g']         ?? 0),
        calcium_mg:     parseFloat(nutriments['calcium_100g']        ?? 0) * 1000,
        iron_mg:        parseFloat(nutriments['iron_100g']           ?? 0) * 1000,
        vitamin_a_mcg:  parseFloat(nutriments['vitamin-a_100g']      ?? 0) * 1_000_000,
        vitamin_c_mg:   parseFloat(nutriments['vitamin-c_100g']      ?? 0) * 1000,
        serving_size_g: 100,
    };
}

async function searchLiveAPI(query: string): Promise<OffNutrition | null> {
    try {
        const params = new URLSearchParams({
            search_terms: query, search_simple: '1', action: 'process',
            json: '1', page_size: '5',
            fields: 'product_name,nutriments',
        });

        const controller = new AbortController();
        const timeout    = setTimeout(() => controller.abort(), 6000);
        const res        = await fetch(`${BASE_SEARCH}?${params}`, {
            headers: { 'User-Agent': USER_AGENT },
            signal:  controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) return null;

        const data = await res.json();
        for (const product of (data.products ?? [])) {
            if (!isRelevantOffResult(product.product_name, query)) continue;
            const nutrition = extractNutrients(product.nutriments);
            if (nutrition && nutrition.calories > 0) return nutrition;
        }
        return null;
    } catch { return null; }
}

// ─── Public exports ───────────────────────────────────────────────────────────

/**
 * Search for a packaged product by name.
 * Queries local DB first (fast, no 503s), falls back to live API.
 */
export async function searchOpenFoodFacts(query: string): Promise<OffNutrition | null> {
    // 1. Local mirror (instant once sync_off.ts has been run)
    const local = await searchLocal(query);
    if (local) return local;

    // 2. Live API fallback (for products not yet in local mirror)
    return searchLiveAPI(query);
}

/**
 * Look up a product by its barcode (EAN-13, UPC-A, etc.).
 * Returns full nutrition per 100g, brand, and Nutri-Score.
 */
export async function lookupBarcode(barcode: string): Promise<{
    name: string;
    brand: string;
    nutrition: OffNutrition;
    nutriscore: string | null;
} | null> {
    // 1. Local mirror (sub-millisecond indexed lookup)
    const local = await lookupLocalBarcode(barcode);
    if (local) {
        return {
            name:       local.product_name ?? 'Unknown product',
            brand:      local.brands       ?? '',
            nutrition:  offRowToNutrition(local),
            nutriscore: local.nutriscore_grade ?? null,
        };
    }

    // 2. Live OFF API fallback
    try {
        const controller = new AbortController();
        const timeout    = setTimeout(() => controller.abort(), 6000);
        const res        = await fetch(
            `${BASE_BARCODE}/${barcode}?fields=product_name,brands,nutriments,nutriscore_grade`,
            { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal }
        );
        clearTimeout(timeout);

        if (!res.ok) return null;

        const data    = await res.json();
        const product = data.product;
        if (!product) return null;

        const nutrition = extractNutrients(product.nutriments);
        if (!nutrition) return null;

        return {
            name:       product.product_name ?? 'Unknown product',
            brand:      product.brands       ?? '',
            nutrition,
            nutriscore: product.nutriscore_grade ?? null,
        };
    } catch { return null; }
}
