/**
 * Sync FRIDA (DTU Denmark Food Composition Database) → Supabase frida_foods
 *
 * FRIDA has no public API — data is distributed as an Excel download.
 *
 * STEP 1 — Download the Excel file manually:
 *   1. Go to https://frida.fooddata.dk/data
 *   2. Download the spreadsheet (e.g. "Frida.xlsx" or similar)
 *   3. Place it at: recipe-api/data/frida.xlsx
 *
 * STEP 2 — Run this script:
 *   SUPABASE_URL=<real> SUPABASE_SERVICE_ROLE_KEY=<real> \
 *     npx ts-node src/scripts/sync_frida.ts [/path/to/frida.xlsx]
 *
 * FRIDA Excel structure (version 5.x):
 *   Sheet "Foods" or first sheet — rows are foods, columns include:
 *     - FoodID / Varenummer
 *     - FoodName (English) / Navn (Danish)
 *     - Energy kcal per 100g
 *     - Protein, Fat, Carbohydrate, Dietary Fibre, Sugars per 100g
 *     - Reference portion / RefWeight (grams)
 *     - Preparation / Tilberedning
 *
 * Column names vary by FRIDA version. The script tries multiple aliases.
 * Run with --dry-run to see detected columns before importing.
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

const db        = createClient(SUPABASE_URL, SUPABASE_KEY);
const DRY_RUN   = process.argv.includes('--dry-run');
const XLSX_PATH = process.argv.find(a => a.endsWith('.xlsx') && !a.includes('ts-node'))
    ?? join(__dirname, '../../data/frida.xlsx');

// ─── Column name aliases ───────────────────────────────────────────────────────
// FRIDA versions differ in column naming. Map multiple aliases → canonical name.

const COL_ALIASES: Record<string, string[]> = {
    food_id:        ['foodid','varenummer','id','nr'],
    food_name_en:   ['foodname','name_en','english name','foodname_en','name'],
    food_name_da:   ['navn','name_da','danish name'],
    preparation:    ['preparation','tilberedning','method'],
    calories:       ['energy, kcal','energy kcal','energi kcal','kcal','energy(kcal)','energy_kcal'],
    protein:        ['protein','protein, total','protein g','protein_g'],
    fat:            ['fat, total','fat','fedt','fat g','fat_g'],
    carbs:          ['carbohydrate, total','carbohydrate','kulhydrat','carbs','carbohydrate_g'],
    fiber:          ['dietary fibre','dietary fiber','fiber','kostfibre','fibre_g'],
    sugar:          ['sugars, total','sugars','sukkerarter','sugar_g'],
    serving_grams:  ['refweight','reference weight','portion','portion g','serving g','servingsize','serving_g','portionvægt'],
    serving_desc:   ['portionbeskrivelse','portion description','serving description'],
};

function findCol(headers: string[], canonical: string): number {
    const aliases = COL_ALIASES[canonical] ?? [canonical];
    const hLower  = headers.map(h => h.toLowerCase().trim());
    for (const alias of aliases) {
        const idx = hLower.findIndex(h => h.includes(alias.toLowerCase()));
        if (idx >= 0) return idx;
    }
    return -1;
}

async function run() {
    if (!fs.existsSync(XLSX_PATH)) {
        console.error(`\nFRIDA Excel file not found at: ${XLSX_PATH}`);
        console.error('\nDownload it from https://frida.fooddata.dk/data and place it there.');
        console.error('Then re-run: npx ts-node src/scripts/sync_frida.ts');
        process.exit(1);
    }

    // Dynamic import of xlsx (install with: npm install xlsx)
    let XLSX: any;
    try {
        XLSX = await import('xlsx');
    } catch {
        console.error('xlsx package missing. Run: npm install xlsx');
        process.exit(1);
    }

    console.log(`\nFRIDA Sync — ${new Date().toISOString()}`);
    console.log(`Source: ${XLSX_PATH}`);

    const workbook  = XLSX.readFile(XLSX_PATH);
    const sheetName = workbook.SheetNames[0];
    const sheet     = workbook.Sheets[sheetName];
    const rows      = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    if (rows.length < 2) { console.error('Empty sheet'); process.exit(1); }

    const headers = rows[0].map((h: any) => String(h ?? ''));
    console.log(`\nDetected ${rows.length - 1} food rows, ${headers.length} columns`);

    // Map columns
    const cols = {
        food_id:       findCol(headers, 'food_id'),
        food_name_en:  findCol(headers, 'food_name_en'),
        food_name_da:  findCol(headers, 'food_name_da'),
        preparation:   findCol(headers, 'preparation'),
        calories:      findCol(headers, 'calories'),
        protein:       findCol(headers, 'protein'),
        fat:           findCol(headers, 'fat'),
        carbs:         findCol(headers, 'carbs'),
        fiber:         findCol(headers, 'fiber'),
        sugar:         findCol(headers, 'sugar'),
        serving_grams: findCol(headers, 'serving_grams'),
        serving_desc:  findCol(headers, 'serving_desc'),
    };

    console.log('\nColumn mapping:');
    for (const [k, idx] of Object.entries(cols)) {
        console.log(`  ${k.padEnd(16)}: ${idx >= 0 ? `col ${idx} "${headers[idx]}"` : 'NOT FOUND'}`);
    }

    if (cols.food_id < 0 || cols.food_name_en < 0) {
        console.error('\nCould not find required columns (food_id, food_name_en).');
        console.error('Run with --dry-run to inspect headers and adjust COL_ALIASES.');
        process.exit(1);
    }

    if (DRY_RUN) { console.log('\n--dry-run: stopping before import.'); return; }

    const n = (r: any[], i: number): number | null => {
        if (i < 0) return null;
        const v = parseFloat(r[i]);
        return isNaN(v) ? null : v;
    };

    const BATCH_SIZE = 100;
    let batch: any[] = [];
    let inserted = 0;

    const flush = async () => {
        if (!batch.length) return;
        const { error } = await db.from('frida_foods').upsert(batch, { onConflict: 'food_id' });
        if (error) console.error('  Upsert error:', error.message);
        batch = [];
    };

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rawId = row[cols.food_id];
        if (!rawId) continue;

        const foodId  = parseInt(String(rawId), 10);
        const nameEn  = String(row[cols.food_name_en] ?? '').trim();
        const nameDa  = cols.food_name_da >= 0 ? String(row[cols.food_name_da] ?? '').trim() : null;
        const prep    = cols.preparation  >= 0 ? String(row[cols.preparation]  ?? '').trim() : null;
        if (!nameEn || isNaN(foodId)) continue;

        const servG   = n(row, cols.serving_grams);
        const servD   = cols.serving_desc >= 0 ? String(row[cols.serving_desc] ?? '').trim() : null;

        batch.push({
            food_id:             foodId,
            food_name:           nameEn,
            food_name_da:        nameDa || null,
            preparation:         prep   || null,
            calories_100g:       n(row, cols.calories),
            protein_100g:        n(row, cols.protein),
            fat_100g:            n(row, cols.fat),
            carbs_100g:          n(row, cols.carbs),
            fiber_100g:          n(row, cols.fiber),
            sugar_100g:          n(row, cols.sugar),
            serving_grams:       servG  || null,
            serving_description: (servD && servG) ? `${servD} (${servG}g)` : servG ? `1 portion (${servG}g)` : null,
        });

        inserted++;
        if (batch.length >= BATCH_SIZE) await flush();
    }

    await flush();
    console.log(`\nImported ${inserted} FRIDA foods into frida_foods`);
}

run().catch(e => { console.error(e); process.exit(1); });
