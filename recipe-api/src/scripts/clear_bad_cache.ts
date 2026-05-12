/**
 * Cache cleanup — evicts ingredient_cache entries with physically impossible
 * calorie densities (> 900 kcal / 100g). These arise when Open Food Facts
 * returns a wrong product match (e.g., "milk" → condensed milk, "green cabbage"
 * → coleslaw kit with dressing) and that bad result gets cached.
 *
 * This is a one-time repair script. After running it, the OFW relevance guard
 * added to openFoodFacts.ts prevents new bad entries from being written.
 *
 * Usage (requires service role key or Supabase CLI session):
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   npx ts-node src/scripts/clear_bad_cache.ts
 *
 * Or with the Supabase CLI:
 *   npx ts-node src/scripts/clear_bad_cache.ts   (uses .env values if set)
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || SUPABASE_URL === '...') {
    console.error('SUPABASE_URL not set. Run this script on the production server or set credentials in .env');
    process.exit(1);
}
if (!KEY || KEY === '...') {
    console.error('SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) not set.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, KEY);

const MAX_CAL_PER_100G = 900; // physical maximum: pure fat ≈ 884 kcal/100g

async function main() {
    console.log('Scanning ingredient_cache for entries with impossible calorie density...');

    // Fetch all cache entries in batches
    let offset = 0;
    const batchSize = 500;
    const badKeys: string[] = [];

    while (true) {
        const { data, error } = await supabase
            .from('ingredient_cache')
            .select('term, nutrition, source')
            .range(offset, offset + batchSize - 1);

        if (error) { console.error('Fetch error:', error.message); break; }
        if (!data || data.length === 0) break;

        for (const row of data) {
            const n: any = row.nutrition;
            if (!n) continue;
            const serving = n.serving_size_g || 100;
            const cal = n.calories ?? 0;
            const calPer100g = (cal / serving) * 100;

            if (calPer100g > MAX_CAL_PER_100G) {
                badKeys.push(row.term);
                console.log(`  BAD  ${calPer100g.toFixed(0)} kcal/100g  [${row.source}]  ${row.term}`);
            }
        }

        offset += batchSize;
        if (data.length < batchSize) break;
    }

    if (badKeys.length === 0) {
        console.log('\nNo bad cache entries found. Cache is clean.');
        return;
    }

    console.log(`\nFound ${badKeys.length} bad entries. Deleting...`);

    // Delete in batches of 100
    for (let i = 0; i < badKeys.length; i += 100) {
        const batch = badKeys.slice(i, i + 100);
        const { error } = await supabase
            .from('ingredient_cache')
            .delete()
            .in('term', batch);

        if (error) console.error(`  Delete error (batch ${i}):`, error.message);
        else console.log(`  Deleted batch ${i}–${i + batch.length - 1}`);
    }

    console.log(`\nDone. Evicted ${badKeys.length} poisoned cache entries.`);
    console.log('They will be re-fetched correctly on next use (OFW relevance guard now active).');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
