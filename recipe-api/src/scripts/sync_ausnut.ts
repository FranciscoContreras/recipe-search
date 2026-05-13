/**
 * Sync AUSNUT 2023 (Food Standards Australia New Zealand) → Supabase ausnut_foods
 *
 * AUSNUT has no API. Download the two Excel files from FSANZ:
 *
 * STEP 1 — Download Excel files manually:
 *   1. Go to https://www.foodstandards.gov.au/science-data/food-nutrient-databases/ausnut/data-files
 *   2. Download "AUSNUT 2023 – Food nutrient profiles" (1.4MB) → save as data/ausnut_nutrients.xlsx
 *   3. Download "AUSNUT 2023 – Food measures" (1.4MB) → save as data/ausnut_measures.xlsx
 *
 * STEP 2 — Run this script:
 *   SUPABASE_URL=<real> SUPABASE_SERVICE_ROLE_KEY=<real> \
 *     npx ts-node src/scripts/sync_ausnut.ts
 *
 * AUSNUT structure:
 *   Nutrients file: food_id, food_name, food_group, energy_kJ, energy_kcal,
 *                   protein, fat, carbs, fiber, sugars, sodium, ...per 100g
 *   Measures file:  food_id, measure_description, quantity_g (per measure)
 *                   9,816 measures for 3,741 foods — the serving size gold mine
 */

import * as dotenv from 'dotenv';
import { resolve, join } from 'path';
dotenv.config({ path: resolve(__dirname, '../../.env') });

import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_URL === '...') {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const db            = createClient(SUPABASE_URL, SUPABASE_KEY);
const DATA_DIR      = join(__dirname, '../../data');
const NUTRIENTS_XLS = process.argv.find(a => a.includes('nutrient')) ?? join(DATA_DIR, 'ausnut_nutrients.xlsx');
const MEASURES_XLS  = process.argv.find(a => a.includes('measure'))  ?? join(DATA_DIR, 'ausnut_measures.xlsx');
const DRY_RUN       = process.argv.includes('--dry-run');

// ─── Column aliases for nutrient profiles ─────────────────────────────────────

const NUTRIENT_COLS: Record<string, string[]> = {
    food_id:    ['food id','food_id','8-digit food id','id'],
    food_name:  ['food name','food_name','name'],
    food_group: ['food group','food_group','group','category'],
    calories:   ['energy with dietary fibre, with sugar alcohols (kcal)','energy, kcal','energy (kcal)','kcal','energy_kcal','energy with dietary fibre (kj)'],
    protein:    ['protein (g)','protein'],
    fat:        ['total fat (g)','fat (g)','fat','total fat'],
    carbs:      ['available carbohydrates, with sugar alcohols (g)','carbohydrates (g)','carbohydrate','total carbohydrates'],
    fiber:      ['dietary fibre (g)','fiber (g)','fiber','fibre'],
    sugar:      ['total sugars (g)','sugar (g)','sugar','sugars'],
    sodium:     ['sodium (mg)','sodium'],
};

const MEASURE_COLS: Record<string, string[]> = {
    food_id:     ['food id','food_id','id'],
    measure_desc:['measure description','measure','description','serving description'],
    quantity_g:  ['quantity (g)','grams','weight (g)','quantity_g','measure weight (g)'],
};

function findCol(headers: string[], key: string, aliases: Record<string, string[]>): number {
    const options = aliases[key] ?? [key];
    const hLower  = headers.map(h => h.toLowerCase().trim());
    for (const opt of options) {
        const idx = hLower.findIndex(h => h.includes(opt.toLowerCase()));
        if (idx >= 0) return idx;
    }
    return -1;
}

function num(row: any[], idx: number): number | null {
    if (idx < 0) return null;
    const v = parseFloat(row[idx]);
    return isNaN(v) ? null : v;
}

/** Pick the best per-item serving from a food's measures list.
 *  AUSNUT measures include things like "1 cup", "1 medium apple", "1 serve" etc. */
function pickBestMeasure(
    measures: Array<{ description: string; grams: number }>,
): { grams: number; description: string } | null {
    if (!measures.length) return null;

    // Exclude bulk/reference measures
    const EXCLUDE = /\b(100g|100 g|per 100|reference)\b/i;
    const ITEM     = /\b(1\s+|one\s+)?(medium|large|small|whole|piece|item|each|slice|strip|serve|cup|tablespoon|teaspoon|clove|ear|stalk|leaf|head|portion)\b/i;

    const realMeasures = measures.filter(m =>
        !EXCLUDE.test(m.description) && m.grams > 2 && m.grams < 800
    );

    const itemMeasure = realMeasures.find(m => ITEM.test(m.description));
    return itemMeasure ?? (realMeasures[0] || null);
}

async function run() {
    // Check files exist
    const missingFiles: string[] = [];
    if (!fs.existsSync(NUTRIENTS_XLS)) missingFiles.push(NUTRIENTS_XLS);
    if (!fs.existsSync(MEASURES_XLS))  missingFiles.push(MEASURES_XLS);

    if (missingFiles.length) {
        console.error('\nMissing AUSNUT Excel files:');
        missingFiles.forEach(f => console.error(`  ${f}`));
        console.error('\nDownload from:');
        console.error('  https://www.foodstandards.gov.au/science-data/food-nutrient-databases/ausnut/data-files');
        process.exit(1);
    }

    let XLSX: any;
    try { XLSX = await import('xlsx'); }
    catch { console.error('xlsx package missing. Run: npm install xlsx'); process.exit(1); }

    console.log(`\nAUSNUT Sync — ${new Date().toISOString()}`);

    // ── Parse measures file first ──────────────────────────────────────────────
    console.log('\nParsing measures file...');
    const measWb   = XLSX.readFile(MEASURES_XLS);
    const measRows = XLSX.utils.sheet_to_json(measWb.Sheets[measWb.SheetNames[0]], { header: 1 }) as any[][];
    const measHdrs = measRows[0].map((h: any) => String(h ?? ''));

    const mFoodId  = findCol(measHdrs, 'food_id',     MEASURE_COLS);
    const mDesc    = findCol(measHdrs, 'measure_desc', MEASURE_COLS);
    const mGrams   = findCol(measHdrs, 'quantity_g',   MEASURE_COLS);

    console.log(`  food_id: col ${mFoodId}, measure_desc: col ${mDesc}, quantity_g: col ${mGrams}`);

    if (mFoodId < 0 || mGrams < 0) {
        console.error('Could not find required measure columns. Run --dry-run to inspect.');
        if (DRY_RUN) { console.log('\nHeaders:', measHdrs.slice(0, 20)); return; }
        process.exit(1);
    }

    // Build map: food_id → [{desc, grams}]
    const measuresMap = new Map<string, Array<{ description: string; grams: number }>>();
    for (let i = 1; i < measRows.length; i++) {
        const r    = measRows[i];
        const fid  = String(r[mFoodId] ?? '').trim();
        const g    = parseFloat(r[mGrams]);
        if (!fid || isNaN(g)) continue;
        const description = mDesc >= 0 ? String(r[mDesc] ?? '').trim() : '';
        if (!measuresMap.has(fid)) measuresMap.set(fid, []);
        measuresMap.get(fid)!.push({ description, grams: g });
    }
    console.log(`  ${measuresMap.size} foods with measures`);

    // ── Parse nutrients file ───────────────────────────────────────────────────
    console.log('\nParsing nutrients file...');
    const nutrWb   = XLSX.readFile(NUTRIENTS_XLS);
    const nutrRows = XLSX.utils.sheet_to_json(nutrWb.Sheets[nutrWb.SheetNames[0]], { header: 1 }) as any[][];
    const nutrHdrs = nutrRows[0].map((h: any) => String(h ?? ''));

    const c = {
        food_id:   findCol(nutrHdrs, 'food_id',   NUTRIENT_COLS),
        food_name: findCol(nutrHdrs, 'food_name',  NUTRIENT_COLS),
        group:     findCol(nutrHdrs, 'food_group', NUTRIENT_COLS),
        cal:       findCol(nutrHdrs, 'calories',   NUTRIENT_COLS),
        prot:      findCol(nutrHdrs, 'protein',    NUTRIENT_COLS),
        fat:       findCol(nutrHdrs, 'fat',        NUTRIENT_COLS),
        carbs:     findCol(nutrHdrs, 'carbs',      NUTRIENT_COLS),
        fiber:     findCol(nutrHdrs, 'fiber',      NUTRIENT_COLS),
        sugar:     findCol(nutrHdrs, 'sugar',      NUTRIENT_COLS),
        sodium:    findCol(nutrHdrs, 'sodium',     NUTRIENT_COLS),
    };

    if (DRY_RUN) {
        console.log('\nNutrient column mapping:');
        for (const [k, idx] of Object.entries(c)) {
            console.log(`  ${k.padEnd(12)}: ${idx >= 0 ? `col ${idx} "${nutrHdrs[idx]}"` : 'NOT FOUND'}`);
        }
        return;
    }

    if (c.food_id < 0 || c.food_name < 0) {
        console.error('Could not find required nutrient columns.'); process.exit(1);
    }

    console.log(`  ${nutrRows.length - 1} food rows`);

    // ── Import to Supabase ─────────────────────────────────────────────────────
    const BATCH = 100;
    let batch: any[] = [];
    let inserted = 0;

    const flush = async () => {
        if (!batch.length) return;
        const { error } = await db.from('ausnut_foods').upsert(batch, { onConflict: 'food_id' });
        if (error) console.error('  Upsert error:', error.message);
        batch = [];
    };

    for (let i = 1; i < nutrRows.length; i++) {
        const row   = nutrRows[i];
        const fid   = String(row[c.food_id] ?? '').trim();
        const name  = String(row[c.food_name] ?? '').trim();
        if (!fid || !name) continue;

        const measures   = measuresMap.get(fid) ?? [];
        const bestMeasure = pickBestMeasure(measures);

        // If no kcal column found, try converting from kJ (divide by 4.184)
        let cal = num(row, c.cal);
        if (cal === null && c.cal >= 0) {
            const kj = num(row, c.cal);
            if (kj) cal = Math.round(kj / 4.184 * 10) / 10;
        }

        batch.push({
            food_id:             fid,
            food_name:           name,
            food_group:          c.group >= 0 ? String(row[c.group] ?? '').trim() || null : null,
            calories_100g:       cal,
            protein_100g:        num(row, c.prot),
            fat_100g:            num(row, c.fat),
            carbs_100g:          num(row, c.carbs),
            fiber_100g:          num(row, c.fiber),
            sugar_100g:          num(row, c.sugar),
            sodium_100g:         num(row, c.sodium),
            serving_grams:       bestMeasure?.grams       ?? null,
            serving_description: bestMeasure?.description ?? null,
        });

        inserted++;
        if (batch.length >= BATCH) await flush();
    }

    await flush();
    console.log(`\nImported ${inserted} AUSNUT foods into ausnut_foods`);
}

run().catch(e => { console.error(e); process.exit(1); });
