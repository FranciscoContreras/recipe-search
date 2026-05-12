/**
 * 100-Recipe Nutrition Accuracy Audit
 *
 * Fetches 100 truly random recipes from production, runs every ingredient list
 * through /nutrition/analyze, and writes a structured JSON report of:
 *  - per-recipe results (total kcal, protein, fat, carbs)
 *  - per-ingredient breakdown (weight resolved, source, calorie contribution)
 *  - coverage stats (found / not-found rates)
 *  - weight-resolution strategy distribution (portionData / unitToGrams / fallback)
 *  - dish-context distribution
 *
 * Usage:
 *   API_KEY=sk_... npx ts-node src/scripts/nutrition_accuracy_audit.ts
 *
 * Output: nutrition_audit_YYYYMMDD.json in cwd
 */

import * as fs from 'fs';

const BASE    = 'https://recipe-base.wearemachina.com';
const API_KEY = process.env.API_KEY || '';

if (!API_KEY) { console.error('Set API_KEY env var'); process.exit(1); }

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch(path: string, opts: RequestInit = {}): Promise<any> {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: {
            'x-api-key': API_KEY,
            'Content-Type': 'application/json',
            ...(opts.headers || {}),
        },
    });
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${await res.text()}`);
    return res.json();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Step 1: Fetch 100 recipes spread across the full DB ─────────────────────

async function fetch100Recipes(): Promise<any[]> {
    // With 23k+ recipes across ~471 pages (50/page), pick 10 pages spread evenly
    // across the full dataset for true diversity.
    const TOTAL_PAGES = 471;
    const PAGES_TO_SAMPLE = [1, 47, 94, 141, 188, 235, 282, 329, 376, 423];

    console.log(`\nFetching recipes from ${PAGES_TO_SAMPLE.length} distributed pages...`);
    const allRecipes: any[] = [];

    for (const page of PAGES_TO_SAMPLE) {
        try {
            const data = await apiFetch(`/recipes?page=${page}&limit=50&full=true`);
            const recipes = (data.recipes || []).filter(
                (r: any) => Array.isArray(r.recipe_ingredients) && r.recipe_ingredients.length >= 3
            );
            console.log(`  Page ${String(page).padStart(3)}: ${recipes.length} usable recipes`);
            allRecipes.push(...recipes);
        } catch (e: any) {
            console.warn(`  Page ${page} failed: ${e.message}`);
        }
        await sleep(200);
    }

    // Shuffle and take first 100
    const shuffled = allRecipes.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 100);
}

// ─── Step 2: Analyze each recipe ─────────────────────────────────────────────

interface AnalysisResult {
    id:             string;
    name:           string;
    ingredientCount: number;
    dishContext:    string;
    total: {
        calories: number;
        protein:  number;
        fat:      number;
        carbs:    number;
        fiber:    number;
    };
    coverage: {
        found:    number;
        notFound: number;
        pct:      number;
    };
    sources: {
        usda:          number;
        openfoodfacts: number;
        fatsecret:     number;
        cached:        number;
    };
    weightStrategies: {
        portionData:  number;  // resolved from USDA portion table
        unitToGrams:  number;  // resolved via unit conversion
        fallback:     number;  // 100g fallback
    };
    notFoundIngredients: string[];
    breakdown: any[];
    rawIngredients: string[];
    error?: string;
}

async function analyzeRecipe(recipe: any): Promise<AnalysisResult> {
    const base: Omit<AnalysisResult, 'total'|'coverage'|'sources'|'weightStrategies'|'breakdown'|'error'> & {
        total?: any; coverage?: any; sources?: any; weightStrategies?: any; breakdown?: any; error?: string;
    } = {
        id:              recipe.id,
        name:            recipe.name,
        ingredientCount: recipe.recipe_ingredients.length,
        dishContext:     'unknown',
        notFoundIngredients: [],
        rawIngredients:  recipe.recipe_ingredients,
    };

    try {
        const data = await apiFetch('/nutrition/analyze', {
            method: 'POST',
            body: JSON.stringify({
                ingredients: recipe.recipe_ingredients,
                recipeName: recipe.name,
            }),
        });

        const breakdown: any[] = data.breakdown || [];

        const sources = { usda: 0, openfoodfacts: 0, fatsecret: 0, cached: 0 };
        const weightStrategies = { portionData: 0, unitToGrams: 0, fallback: 0 };
        const notFound: string[] = [];

        for (const item of breakdown) {
            if (item.status === 'not_found') {
                notFound.push(item.ingredient);
                continue;
            }
            // Source counting
            const src = item.source as string;
            if (src === 'usda') sources.usda++;
            else if (src === 'openfoodfacts') sources.openfoodfacts++;
            else if (src === 'fatsecret') sources.fatsecret++;
            else sources.cached++;

            // Weight strategy detection: if weightGrams was resolved via portions,
            // the item would have parsed.unit === '' or count-based + non-default weight.
            // We approximate: if the resolved weight differs significantly from what
            // unitToGrams would give, it came from portions.
            const wg = item.parsed?.weightGrams ?? 0;
            const unit = item.parsed?.unit ?? '';
            const qty  = item.parsed?.qty  ?? 1;

            // Simple heuristic: if unit is empty or count-like and weight is not 100*qty, likely portions
            if (!unit || ['', 'large', 'medium', 'small', 'whole'].includes(unit.toLowerCase())) {
                if (wg > 0 && wg !== 100 * qty) {
                    weightStrategies.portionData++;
                } else if (wg === 100) {
                    weightStrategies.fallback++;
                } else {
                    weightStrategies.unitToGrams++;
                }
            } else {
                weightStrategies.unitToGrams++;
            }
        }

        const found = breakdown.filter(b => b.status !== 'not_found').length;

        return {
            ...base,
            dishContext: data.dishContext || 'standard',
            total: {
                calories: data.total?.calories ?? 0,
                protein:  data.total?.protein  ?? 0,
                fat:      data.total?.fat      ?? 0,
                carbs:    data.total?.carbs    ?? 0,
                fiber:    data.total?.fiber    ?? 0,
            },
            coverage: {
                found,
                notFound: notFound.length,
                pct: Math.round(100 * found / breakdown.length),
            },
            sources,
            weightStrategies,
            notFoundIngredients: notFound,
            breakdown,
        } as AnalysisResult;

    } catch (e: any) {
        return {
            ...base,
            total:            { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 },
            coverage:         { found: 0, notFound: 0, pct: 0 },
            sources:          { usda: 0, openfoodfacts: 0, fatsecret: 0, cached: 0 },
            weightStrategies: { portionData: 0, unitToGrams: 0, fallback: 0 },
            breakdown:        [],
            error:            e.message,
        } as AnalysisResult;
    }
}

// ─── Step 3: Generate report ──────────────────────────────────────────────────

function computeReport(results: AnalysisResult[]) {
    const valid = results.filter(r => !r.error && r.total.calories > 0);
    const failed = results.filter(r => r.error);
    const zeroCal = results.filter(r => !r.error && r.total.calories === 0);

    // Aggregate stats
    const totalFound    = valid.reduce((s, r) => s + r.coverage.found, 0);
    const totalIngr     = valid.reduce((s, r) => s + r.ingredientCount, 0);
    const overallCovPct = Math.round(100 * totalFound / totalIngr);

    const avgCal     = Math.round(valid.reduce((s, r) => s + r.total.calories, 0) / valid.length);
    const avgProtein = Math.round(valid.reduce((s, r) => s + r.total.protein,  0) / valid.length);
    const avgFat     = Math.round(valid.reduce((s, r) => s + r.total.fat,      0) / valid.length);
    const avgCarbs   = Math.round(valid.reduce((s, r) => s + r.total.carbs,    0) / valid.length);

    // Source distribution
    const sources = valid.reduce((acc, r) => {
        acc.usda          += r.sources.usda;
        acc.openfoodfacts += r.sources.openfoodfacts;
        acc.fatsecret     += r.sources.fatsecret;
        acc.cached        += r.sources.cached;
        return acc;
    }, { usda: 0, openfoodfacts: 0, fatsecret: 0, cached: 0 });

    // Dish context distribution
    const contextDist: Record<string, number> = {};
    for (const r of valid) {
        contextDist[r.dishContext] = (contextDist[r.dishContext] || 0) + 1;
    }

    // Calorie plausibility: flag recipes with <100 kcal or >5000 kcal (whole recipe)
    const suspiciouslyLow  = valid.filter(r => r.total.calories < 100);
    const suspiciouslyHigh = valid.filter(r => r.total.calories > 5000);

    // NOT-FOUND ingredient frequency
    const notFoundFreq: Record<string, number> = {};
    for (const r of valid) {
        for (const ing of r.notFoundIngredients) {
            const key = ing.toLowerCase().replace(/\d+\s*(g|ml|oz|cup|tbsp|tsp|lb|kg)?\s*/gi, '').trim().slice(0, 40);
            notFoundFreq[key] = (notFoundFreq[key] || 0) + 1;
        }
    }
    const topNotFound = Object.entries(notFoundFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([term, count]) => ({ term, count }));

    // Coverage distribution histogram (buckets: 0-60%, 60-80%, 80-90%, 90-100%, 100%)
    const covBuckets = { 'under60': 0, '60_79': 0, '80_89': 0, '90_99': 0, '100': 0 };
    for (const r of valid) {
        const p = r.coverage.pct;
        if (p < 60)       covBuckets['under60']++;
        else if (p < 80)  covBuckets['60_79']++;
        else if (p < 90)  covBuckets['80_89']++;
        else if (p < 100) covBuckets['90_99']++;
        else              covBuckets['100']++;
    }

    return {
        generatedAt:    new Date().toISOString(),
        recipesAnalyzed: results.length,
        recipesSuccessful: valid.length,
        recipesFailed:   failed.length,
        recipesZeroCalorie: zeroCal.length,
        overall: {
            ingredientCoverage: `${totalFound}/${totalIngr} (${overallCovPct}%)`,
            avgCaloriesPerRecipe: avgCal,
            avgProtein: avgProtein,
            avgFat:     avgFat,
            avgCarbs:   avgCarbs,
        },
        sourceDistribution: sources,
        dishContextDistribution: contextDist,
        coverageHistogram: covBuckets,
        suspiciouslyLow:  suspiciouslyLow.map(r  => ({ id: r.id, name: r.name, calories: r.total.calories, ingredients: r.ingredientCount, coverage: r.coverage.pct })),
        suspiciouslyHigh: suspiciouslyHigh.map(r => ({ id: r.id, name: r.name, calories: r.total.calories, ingredients: r.ingredientCount, coverage: r.coverage.pct })),
        topMissingIngredients: topNotFound,
        failedRecipes:   failed.map(r => ({ id: r.id, name: r.name, error: r.error })),
        perRecipeResults: results,
    };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('═'.repeat(70));
    console.log('  RECIPE BASE — 100-RECIPE NUTRITION ACCURACY AUDIT');
    console.log('═'.repeat(70));

    // 1. Fetch recipes
    const recipes = await fetch100Recipes();
    console.log(`\nFetched ${recipes.length} recipes for analysis\n`);

    // 2. Analyze each recipe (with rate limiting: max 3 concurrent)
    const results: AnalysisResult[] = [];
    let done = 0;

    const BATCH_SIZE = 3;
    for (let i = 0; i < recipes.length; i += BATCH_SIZE) {
        const batch = recipes.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(r => analyzeRecipe(r)));
        results.push(...batchResults);
        done += batch.length;

        for (const r of batchResults) {
            const status = r.error ? '❌ ERR' :
                           r.total.calories === 0 ? '⚠️  0kc' :
                           r.coverage.pct < 70    ? `⚠️  ${r.coverage.pct}%` :
                                                    `✓  ${r.coverage.pct}%`;
            const cal = r.total.calories ? `${r.total.calories}kcal` : '   n/a';
            console.log(`  [${String(done).padStart(3)}/${recipes.length}] ${status}  ${cal.padStart(8)}  ${r.name.slice(0, 45)}`);
        }

        // Gentle rate limiting between batches
        if (i + BATCH_SIZE < recipes.length) await sleep(400);
    }

    // 3. Build report
    const report = computeReport(results);

    const filename = `nutrition_audit_${new Date().toISOString().slice(0, 10)}.json`;
    fs.writeFileSync(filename, JSON.stringify(report, null, 2));

    // 4. Print summary
    console.log('\n' + '═'.repeat(70));
    console.log('  AUDIT SUMMARY');
    console.log('═'.repeat(70));
    console.log(`  Recipes analyzed:   ${report.recipesAnalyzed}`);
    console.log(`  Successful:         ${report.recipesSuccessful}`);
    console.log(`  Failed (API error): ${report.recipesFailed}`);
    console.log(`  Zero-calorie:       ${report.recipesZeroCalorie}`);
    console.log(`\n  Ingredient coverage: ${report.overall.ingredientCoverage}`);
    console.log(`  Avg calories/recipe: ${report.overall.avgCaloriesPerRecipe} kcal`);
    console.log(`  Avg protein:         ${report.overall.avgProtein}g`);
    console.log(`  Avg fat:             ${report.overall.avgFat}g`);
    console.log(`  Avg carbs:           ${report.overall.avgCarbs}g`);

    console.log('\n  Source Distribution:');
    const { usda, openfoodfacts, fatsecret, cached } = report.sourceDistribution;
    const totalSrc = usda + openfoodfacts + fatsecret + cached;
    console.log(`    USDA:          ${usda} (${Math.round(100*usda/totalSrc)}%)`);
    console.log(`    Open Food Facts: ${openfoodfacts} (${Math.round(100*openfoodfacts/totalSrc)}%)`);
    console.log(`    FatSecret:     ${fatsecret} (${Math.round(100*fatsecret/totalSrc)}%)`);
    console.log(`    Cached:        ${cached} (${Math.round(100*cached/totalSrc)}%)`);

    console.log('\n  Coverage Histogram:');
    console.log(`    100%:       ${report.coverageHistogram['100']}`);
    console.log(`    90-99%:     ${report.coverageHistogram['90_99']}`);
    console.log(`    80-89%:     ${report.coverageHistogram['80_89']}`);
    console.log(`    60-79%:     ${report.coverageHistogram['60_79']}`);
    console.log(`    Under 60%:  ${report.coverageHistogram['under60']}`);

    console.log('\n  Dish Context Distribution:');
    for (const [ctx, count] of Object.entries(report.dishContextDistribution).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${ctx.padEnd(12)}: ${count}`);
    }

    if (report.suspiciouslyLow.length > 0) {
        console.log('\n  ⚠️  Suspiciously LOW calorie recipes (< 100 kcal total):');
        for (const r of report.suspiciouslyLow.slice(0, 10)) {
            console.log(`    ${r.name.slice(0, 45).padEnd(45)} ${r.calories}kcal  cov=${r.coverage}%`);
        }
    }

    if (report.suspiciouslyHigh.length > 0) {
        console.log('\n  ⚠️  Suspiciously HIGH calorie recipes (> 5000 kcal total):');
        for (const r of report.suspiciouslyHigh.slice(0, 10)) {
            console.log(`    ${r.name.slice(0, 45).padEnd(45)} ${r.calories}kcal  cov=${r.coverage}%`);
        }
    }

    console.log('\n  Top 20 Missing Ingredients:');
    for (const { term, count } of report.topMissingIngredients.slice(0, 20)) {
        console.log(`    ${String(count).padStart(2)}x  ${term}`);
    }

    console.log(`\n  Full report: ${filename}`);
    console.log('═'.repeat(70) + '\n');
}

main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1); });
