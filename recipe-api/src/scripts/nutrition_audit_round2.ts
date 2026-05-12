/**
 * Round-2 Nutrition Accuracy Audit — 100 recipes, Gemini CLI independent verification
 *
 * Fetches 100 recipes from pages NOT used in round 1 (different 10-page spread),
 * analyzes them via the production API, then uses Gemini CLI to independently
 * estimate calories for suspicious and diverse recipe cases.
 *
 * Gemini acts as a second opinion: given a recipe name + ingredient list, it
 * estimates total recipe calories. Differences > 25% trigger deeper investigation.
 *
 * Usage:
 *   API_KEY=sk_... npx ts-node src/scripts/nutrition_audit_round2.ts
 *
 * Requires: gemini CLI installed (gemini --skip-trust -p "...")
 */

import * as fs from 'fs';
import { execSync } from 'child_process';

const BASE    = 'https://recipe-base.wearemachina.com';
const API_KEY = process.env.API_KEY || '';

if (!API_KEY) { console.error('Set API_KEY env var'); process.exit(1); }

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch(path: string, opts: RequestInit = {}): Promise<any> {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${await res.text()}`);
    return res.json();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function askGemini(prompt: string): string {
    try {
        // --yolo enables all Gemini tools (Google Search, web browsing, etc.)
        // so Gemini can research real nutrition data from authoritative sources.
        const escaped = prompt.replace(/'/g, "'\\''");
        const result = execSync(
            `gemini --skip-trust --yolo -p '${escaped}' 2>/dev/null`,
            { timeout: 60000, encoding: 'utf8' }
        );
        return result.trim();
    } catch (e: any) {
        // Fall back without yolo (read-only Gemini) if tools time out
        try {
            const escaped = prompt.replace(/'/g, "'\\''");
            const result = execSync(
                `gemini --skip-trust -p '${escaped}' 2>/dev/null`,
                { timeout: 30000, encoding: 'utf8' }
            );
            return result.trim();
        } catch (e2: any) {
            return `GEMINI_ERROR: ${e2.message?.slice(0, 100)}`;
        }
    }
}

function extractCalFromGemini(response: string): number | null {
    // Gemini with --yolo includes tool-use research before the final answer.
    // Search for the specific format we instructed ("Total recipe calories: X kcal")
    // then fall back to broader patterns. Scan from the END of the response so
    // intermediate web-search results (which may contain per-serving numbers) don't
    // shadow the final total.

    // Specific output format we instruct Gemini to use
    const specific = /total\s+recipe\s+calories?:\s*([\d,]+)\s*kcal/i;
    const allMatches: number[] = [];
    let m: RegExpExecArray | null;

    // Collect ALL "Total recipe calories: X" matches (there may be one in research output
    // and one in the final answer — take the LAST one as it's most likely the final answer)
    const specificGlobal = /total\s+recipe\s+calories?:\s*([\d,]+)/gi;
    while ((m = specificGlobal.exec(response)) !== null) {
        const val = parseInt(m[1].replace(/,/g, ''), 10);
        if (val > 100 && val < 200000) allMatches.push(val);
    }
    if (allMatches.length > 0) return allMatches[allMatches.length - 1]; // last = final answer

    // Broader fallback patterns (also take the last match)
    const fallbacks = [
        /approximately\s+([\d,]+)(?:\s*[-–]\s*[\d,]+)?\s*(?:kcal|calories?|cal)/gi,
        /~\s*([\d,]+)\s*(?:kcal|calories?|cal)/gi,
        /([\d,]+)\s*kcal/gi,
    ];
    for (const pat of fallbacks) {
        const matches: number[] = [];
        while ((m = pat.exec(response)) !== null) {
            const val = parseInt(m[1].replace(/,/g, ''), 10);
            if (val > 200 && val < 200000) matches.push(val);
        }
        if (matches.length > 0) return matches[matches.length - 1];
    }
    return null;
}

// ─── Step 1: Fetch 100 recipes from different pages than round 1 ──────────────
// Round 1 used pages: 1, 47, 94, 141, 188, 235, 282, 329, 376, 423
// Round 2 uses: 20, 65, 112, 160, 210, 257, 307, 352, 400, 445

async function fetch100Recipes(): Promise<any[]> {
    const PAGES_TO_SAMPLE = [20, 65, 112, 160, 210, 257, 307, 352, 400, 445];
    console.log(`\nFetching from ${PAGES_TO_SAMPLE.length} pages (different from round 1)...`);
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

    const shuffled = allRecipes.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 100);
}

// ─── Step 2: Analyze each recipe via production API ───────────────────────────

interface RecipeResult {
    id:       string;
    name:     string;
    servings: number | null;
    ingredients: string[];
    apiResult: {
        calories: number;
        protein:  number;
        fat:      number;
        carbs:    number;
        dishContext: string;
        coverage: number;  // % of ingredients found
    };
    gemini?: {
        rawResponse: string;
        estimatedCalTotal: number | null;
        calPerServing: number | null;
        agreement: 'good' | 'moderate' | 'poor' | 'unknown';
        pctDiff: number | null;
    };
}

async function analyzeViaAPI(recipe: any): Promise<RecipeResult> {
    try {
        const data = await apiFetch('/nutrition/analyze', {
            method: 'POST',
            body: JSON.stringify({ ingredients: recipe.recipe_ingredients, recipeName: recipe.name }),
        });

        const breakdown: any[] = data.breakdown || [];
        const found = breakdown.filter(b => b.status !== 'not_found').length;
        const coverage = Math.round(100 * found / (breakdown.length || 1));

        // Try to infer servings from recipe metadata
        const servings = recipe.servings || recipe.yields || null;

        return {
            id:          recipe.id,
            name:        recipe.name,
            servings,
            ingredients: recipe.recipe_ingredients,
            apiResult: {
                calories:    data.total?.calories ?? 0,
                protein:     data.total?.protein  ?? 0,
                fat:         data.total?.fat      ?? 0,
                carbs:       data.total?.carbs    ?? 0,
                dishContext: data.dishContext ?? 'standard',
                coverage,
            },
        };
    } catch (e: any) {
        return {
            id: recipe.id, name: recipe.name, servings: null,
            ingredients: recipe.recipe_ingredients,
            apiResult: { calories: 0, protein: 0, fat: 0, carbs: 0, dishContext: 'unknown', coverage: 0 },
        };
    }
}

// ─── Step 3: Gemini independent verification ──────────────────────────────────
// Select recipes for Gemini review: diverse types + suspicious outliers

function selectForGeminiReview(results: RecipeResult[]): RecipeResult[] {
    const sorted = [...results].sort((a, b) => b.apiResult.calories - a.apiResult.calories);

    const selected = new Set<string>();
    const picked: RecipeResult[] = [];

    // Always include top 5 highest calorie recipes (most likely wrong)
    sorted.slice(0, 5).forEach(r => { if (!selected.has(r.id)) { selected.add(r.id); picked.push(r); } });

    // Include 5 lowest calorie (non-beverage, non-sauce)
    [...sorted].reverse().slice(0, 10)
        .filter(r => r.ingredients.length >= 5)
        .slice(0, 5)
        .forEach(r => { if (!selected.has(r.id)) { selected.add(r.id); picked.push(r); } });

    // Include 10 recipes spread across the calorie range for diverse validation
    const step = Math.floor(results.length / 10);
    sorted.filter((_, i) => i % step === 0).slice(0, 10).forEach(r => {
        if (!selected.has(r.id)) { selected.add(r.id); picked.push(r); }
    });

    // Cap at 20 total Gemini queries to keep runtime reasonable
    return picked.slice(0, 20);
}

async function runGeminiVerification(result: RecipeResult): Promise<void> {
    const ingredientsList = result.ingredients.slice(0, 20).join('\n- ');
    const servingHint = result.servings ? `The recipe makes approximately ${result.servings} servings.` : '';

    const prompt = `Search Google and any nutrition databases to research the calorie content of this recipe. Calculate or find the total calories for the ENTIRE recipe batch.

Recipe name: ${result.name}
${servingHint}
Ingredients:
- ${ingredientsList}

Instructions:
1. Search for this recipe online or look up each main ingredient's calorie content in USDA / nutrition databases
2. Calculate or estimate the TOTAL calories for the ENTIRE recipe (not per serving)
3. If the recipe is found online with nutrition info, use that

Reply with ONLY these two lines (no explanation):
Total recipe calories: [number] kcal
Per serving: [number] kcal ([N] servings)`;

    const geminiResponse = askGemini(prompt);
    const estimatedTotal = extractCalFromGemini(geminiResponse);

    let agreement: 'good' | 'moderate' | 'poor' | 'unknown' = 'unknown';
    let pctDiff: number | null = null;

    if (estimatedTotal && result.apiResult.calories > 0) {
        const diff = Math.abs(result.apiResult.calories - estimatedTotal) / estimatedTotal;
        pctDiff = Math.round(diff * 100);
        if      (diff <= 0.25) agreement = 'good';
        else if (diff <= 0.50) agreement = 'moderate';
        else                   agreement = 'poor';
    }

    result.gemini = { rawResponse: geminiResponse, estimatedCalTotal: estimatedTotal, calPerServing: null, agreement, pctDiff };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('═'.repeat(72));
    console.log('  ROUND 2 AUDIT — Post-fix verification + Gemini independent check');
    console.log('═'.repeat(72));

    // 1. Fetch
    const recipes = await fetch100Recipes();
    console.log(`\nAnalyzing ${recipes.length} recipes...\n`);

    // 2. Analyze via API
    const results: RecipeResult[] = [];
    let done = 0;
    const BATCH = 3;
    for (let i = 0; i < recipes.length; i += BATCH) {
        const batch = recipes.slice(i, i + BATCH);
        const batchResults = await Promise.all(batch.map(analyzeViaAPI));
        results.push(...batchResults);
        done += batch.length;
        for (const r of batchResults) {
            const cal = r.apiResult.calories;
            const flag = cal > 5000 ? '⚠️ HIGH' : cal < 100 && r.ingredients.length > 3 ? '⚠️  LOW' : '✓     ';
            console.log(`  [${String(done).padStart(3)}]  ${flag}  ${String(cal).padStart(6)} kcal  cov=${r.apiResult.coverage}%  ${r.name.slice(0, 42)}`);
        }
        if (i + BATCH < recipes.length) await sleep(400);
    }

    // 3. Gemini verification
    const forGemini = selectForGeminiReview(results);
    console.log(`\n${'─'.repeat(72)}`);
    console.log(`  GEMINI INDEPENDENT VERIFICATION (${forGemini.length} recipes)`);
    console.log('─'.repeat(72));

    for (const r of forGemini) {
        process.stdout.write(`  Querying Gemini: ${r.name.slice(0, 50)}... `);
        await runGeminiVerification(r);
        const g = r.gemini!;
        const badge = g.agreement === 'good' ? '✅' : g.agreement === 'moderate' ? '⚠️ ' : g.agreement === 'poor' ? '❌' : '❓';
        const pct = g.pctDiff != null ? `${g.pctDiff}% diff` : 'no parse';
        console.log(`\n    API: ${r.apiResult.calories} kcal  |  Gemini: ${g.estimatedCalTotal ?? '?'} kcal  |  ${badge}  ${pct}`);
        if (g.agreement === 'poor') {
            console.log(`    ⚠  Gemini said: ${g.rawResponse.slice(0, 120)}`);
        }
        await sleep(500);
    }

    // 4. Report
    const goodAgreement = forGemini.filter(r => r.gemini?.agreement === 'good').length;
    const poorAgreement = forGemini.filter(r => r.gemini?.agreement === 'poor').length;
    const moderateAgreement = forGemini.filter(r => r.gemini?.agreement === 'moderate').length;
    const unknownAgreement = forGemini.filter(r => r.gemini?.agreement === 'unknown').length;

    // Calorie stats
    const validResults = results.filter(r => r.apiResult.calories > 0);
    const avgCal = Math.round(validResults.reduce((s, r) => s + r.apiResult.calories, 0) / validResults.length);
    const over5k  = results.filter(r => r.apiResult.calories > 5000).length;
    const under100 = results.filter(r => r.apiResult.calories < 100 && r.ingredients.length > 3).length;

    console.log(`\n${'═'.repeat(72)}`);
    console.log('  ROUND 2 SUMMARY');
    console.log('═'.repeat(72));
    console.log(`  Total recipes analyzed:    ${results.length}`);
    console.log(`  Avg calories (whole recipe):${avgCal} kcal`);
    console.log(`  Over 5000 kcal:             ${over5k}`);
    console.log(`  Under 100 kcal (≥5 ingr):  ${under100}`);
    console.log(`\n  Gemini agreement (${forGemini.length} sampled):`);
    console.log(`    ✅ Good (≤25% diff):     ${goodAgreement}`);
    console.log(`    ⚠️  Moderate (≤50% diff): ${moderateAgreement}`);
    console.log(`    ❌ Poor (>50% diff):      ${poorAgreement}`);
    console.log(`    ❓ Unknown (no parse):    ${unknownAgreement}`);

    if (poorAgreement > 0) {
        console.log('\n  ❌ POOR AGREEMENT cases (need investigation):');
        forGemini.filter(r => r.gemini?.agreement === 'poor').forEach(r => {
            console.log(`    ${r.name.slice(0, 55)}`);
            console.log(`      API: ${r.apiResult.calories} kcal  Gemini: ${r.gemini?.estimatedCalTotal ?? '?'} kcal`);
        });
    }

    const filename = `nutrition_audit_round2_${new Date().toISOString().slice(0, 10)}.json`;
    fs.writeFileSync(filename, JSON.stringify({ results, geminiSample: forGemini }, null, 2));
    console.log(`\n  Full report: ${filename}`);
    console.log('═'.repeat(72) + '\n');
}

main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1); });
