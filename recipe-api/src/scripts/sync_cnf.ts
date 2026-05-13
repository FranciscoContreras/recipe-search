/**
 * Sync Canadian Nutrient File (CNF) → Supabase cnf_foods table
 *
 * Health Canada's CNF REST API provides:
 *  - ~5,700 foods with macronutrient data
 *  - Serving sizes with conversion_factor_value (serving_grams = factor × 100)
 *
 * The CNF API has no text search endpoint — it returns all foods. We mirror
 * everything once, then the serving enrichment pipeline uses Supabase FTS.
 *
 * Usage:
 *   SUPABASE_URL=<real> SUPABASE_SERVICE_ROLE_KEY=<real> \
 *     npx ts-node src/scripts/sync_cnf.ts
 *
 *   # Incremental (only foods missing serving_grams):
 *   npx ts-node src/scripts/sync_cnf.ts --missing-only
 *
 * Runtime: ~15-30 minutes (5,700 foods × 2 API calls each, with rate-limit back-off)
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { createClient } from '@supabase/supabase-js';

const CNF_BASE = 'https://food-nutrition.canada.ca/api/canadian-nutrient-file';

// CNF nutrient IDs (from /nutrientname endpoint)
const NUTRIENT = {
    ENERGY_KCAL: 208,
    PROTEIN:     203,
    FAT:         204,
    CARBS:       205,
    FIBER:       291,
    SUGAR:       269,
} as const;

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_URL === '...') {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const MISSING_ONLY = process.argv.includes('--missing-only');
const BATCH_SIZE   = 50; // upsert batch size
const RATE_DELAY   = 120; // ms between API calls to avoid 429s

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

interface CnfFood {
    food_code:        number;
    food_description: string;
}

interface CnfNutrient {
    food_code:        number;
    nutrient_name_id: number;
    nutrient_value:   number;
}

interface CnfServing {
    food_code:               number;
    conversion_factor_value: number; // × 100 = grams
    measure_name:            string;
}

async function cnfFetch<T>(path: string): Promise<T[]> {
    const url = `${CNF_BASE}${path}`;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (res.status === 429) {
                await sleep(5000 * (attempt + 1));
                continue;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json() as T[];
        } catch (e: any) {
            if (attempt === 2) throw e;
            await sleep(2000);
        }
    }
    return [];
}

/** Pick the most useful serving from a food's serving size list.
 *  Prefers per-item measures over bulk (100g, 100ml) or arbitrary weights. */
function pickBestServing(servings: CnfServing[]): { grams: number; description: string } | null {
    if (!servings.length) return null;

    // Parse grams from measure_name ("1 food guide serving = 90g" → 90g)
    // Fall back to conversion_factor_value × 100
    const parsed = servings.map(s => {
        const gramMatch = s.measure_name.match(/=\s*(\d+(?:\.\d+)?)\s*g/i);
        const grams = gramMatch
            ? parseFloat(gramMatch[1])
            : Math.round(s.conversion_factor_value * 100 * 10) / 10;
        return { grams, description: s.measure_name };
    });

    // Exclude 100g reference entries (those are the base, not a real serving)
    const realServings = parsed.filter(s => Math.abs(s.grams - 100) > 5 && s.grams > 2 && s.grams < 600);
    if (realServings.length === 0) return parsed[0] ?? null;

    // Prefer measures that look like individual item portions
    const ITEM_SIGNALS = /\b(slice|strip|piece|item|medium|large|small|whole|cup|tbsp|tsp|clove|ear|stalk|leaf|wedge|portion|serving|egg|cookie|cracker)\b/i;
    const itemServing = realServings.find(s => ITEM_SIGNALS.test(s.description));
    return itemServing ?? realServings[0];
}

async function run() {
    console.log(`\nCNF Sync — ${new Date().toISOString()}`);
    console.log(`Mode: ${MISSING_ONLY ? 'missing serving_grams only' : 'full sync'}`);

    // Fetch all food codes
    console.log('\nFetching CNF food list...');
    const allFoods = await cnfFetch<CnfFood>('/food/?lang=en&type=json');
    console.log(`  ${allFoods.length} foods found`);

    let foodCodes = allFoods.map(f => f.food_code);

    // If --missing-only, filter to foods not yet in the table or missing serving_grams
    if (MISSING_ONLY) {
        const { data: existing } = await db
            .from('cnf_foods')
            .select('food_code')
            .not('serving_grams', 'is', null);
        const done = new Set((existing ?? []).map((r: any) => r.food_code));
        foodCodes = foodCodes.filter(c => !done.has(c));
        console.log(`  ${foodCodes.length} foods need enrichment`);
    }

    let processed = 0;
    let failed    = 0;
    const upsertBatch: any[] = [];

    const flush = async () => {
        if (upsertBatch.length === 0) return;
        const { error } = await db.from('cnf_foods').upsert(upsertBatch, { onConflict: 'food_code' });
        if (error) console.error('  Upsert error:', error.message);
        upsertBatch.length = 0;
    };

    for (const food of allFoods) {
        if (MISSING_ONLY && !foodCodes.includes(food.food_code)) continue;

        try {
            await sleep(RATE_DELAY);

            // Fetch nutrients and servings in parallel
            const [nutrients, servings] = await Promise.all([
                cnfFetch<CnfNutrient>(`/nutrientamount/?id=${food.food_code}&lang=en&type=json`),
                cnfFetch<CnfServing>(`/servingsize/?id=${food.food_code}&lang=en&type=json`),
            ]);

            const val = (id: number) =>
                nutrients.find(n => n.nutrient_name_id === id)?.nutrient_value ?? null;

            const bestServing = pickBestServing(servings);

            upsertBatch.push({
                food_code:           food.food_code,
                food_name:           food.food_description,
                calories_100g:       val(NUTRIENT.ENERGY_KCAL),
                protein_100g:        val(NUTRIENT.PROTEIN),
                fat_100g:            val(NUTRIENT.FAT),
                carbs_100g:          val(NUTRIENT.CARBS),
                fiber_100g:          val(NUTRIENT.FIBER),
                sugar_100g:          val(NUTRIENT.SUGAR),
                serving_grams:       bestServing?.grams       ?? null,
                serving_description: bestServing?.description ?? null,
            });

            processed++;

            if (upsertBatch.length >= BATCH_SIZE) await flush();

            if (processed % 200 === 0) {
                console.log(`  ${processed}/${foodCodes.length} processed, ${failed} failed`);
            }
        } catch (e: any) {
            console.warn(`  Failed food_code ${food.food_code}: ${e.message}`);
            failed++;
        }
    }

    await flush();

    // Also update ingredient_cache rows that can now be enriched from CNF
    console.log('\nBack-filling ingredient_cache from CNF data...');
    await backfillCacheFromCnf();

    console.log(`\nDone. Processed: ${processed}, Failed: ${failed}`);
}

/** Cross-reference: for any ingredient_cache entries lacking serving_grams,
 *  try to find a matching CNF food and copy over the serving data. */
async function backfillCacheFromCnf() {
    const { data: missingRows } = await db
        .from('ingredient_cache')
        .select('term, nutrition')
        .is('serving_grams', null)
        .limit(2000);

    if (!missingRows?.length) { console.log('  Nothing to backfill.'); return; }

    let filled = 0;
    for (const row of missingRows as any[]) {
        // Extract ingredient name from cache key (strip "v11:" prefix and ":cooked" suffix)
        const ingredientName = (row.term as string)
            .replace(/^v\d+:/, '')
            .replace(/:cooked$/, '');

        const { data: cnfMatch } = await db
            .from('cnf_foods')
            .select('serving_grams, serving_description')
            .textSearch('fts', ingredientName, { type: 'websearch', config: 'english' })
            .not('serving_grams', 'is', null)
            .limit(1)
            .single();

        if (!cnfMatch?.serving_grams) continue;

        await db
            .from('ingredient_cache')
            .update({
                serving_grams:       cnfMatch.serving_grams,
                serving_description: cnfMatch.serving_description,
            })
            .eq('term', row.term);

        filled++;
    }

    console.log(`  Back-filled ${filled}/${missingRows.length} cache entries`);
}

run().catch(e => { console.error(e); process.exit(1); });
