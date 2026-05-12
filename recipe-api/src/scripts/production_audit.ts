/**
 * Production API audit — tests nutrition analysis, search quality, and data validity
 * against the live server using a real API key.
 *
 * Usage:
 *   API_KEY=sk_... npx ts-node src/scripts/production_audit.ts
 *   API_KEY=sk_... npx ts-node src/scripts/production_audit.ts --base http://localhost:3034
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const BASE  = process.argv.includes('--base')
    ? process.argv[process.argv.indexOf('--base') + 1]
    : 'https://recipe-base.wearemachina.com';
const KEY   = process.env.API_KEY || '';

if (!KEY) {
    console.error('Set API_KEY env var: API_KEY=sk_... npx ts-node src/scripts/production_audit.ts');
    process.exit(1);
}

async function api(path: string, opts: RequestInit = {}): Promise<any> {
    const res = await fetch(BASE + path, {
        ...opts,
        headers: { 'x-api-key': KEY, 'Content-Type': 'application/json', ...((opts as any).headers || {}) }
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} → ${BASE + path}`);
    return res.json();
}

function badge(got: number, exp: number): string {
    const d = Math.abs(got - exp) / exp;
    return d <= 0.10 ? '✅' : d <= 0.25 ? '⚠️ ' : '❌';
}
function diff(got: number, exp: number): string {
    const d = ((got - exp) / exp) * 100;
    return (d > 0 ? '+' : '') + d.toFixed(0) + '%';
}

// ─── Gemini / USDA reference values ───────────────────────────────────────
const RECIPES = [
    {
        name: 'Classic Spaghetti Bolognese',
        servings: 4,
        ingredients: [
            '400g spaghetti', '500g ground beef', '1 medium onion', '3 cloves garlic',
            '400g canned tomatoes', '2 tablespoons olive oil', '1 teaspoon salt',
            '1 teaspoon black pepper', '1 teaspoon dried oregano',
        ],
        ref: { calories: 783, protein: 36, fat: 34, carbs: 83 },
    },
    {
        name: 'Caesar Salad',
        servings: 2,
        ingredients: [
            '1 large romaine lettuce', '2 tablespoons olive oil', '1 tablespoon lemon juice',
            '1 clove garlic', '30g parmesan cheese', '30g croutons', '1 egg yolk',
        ],
        ref: { calories: 325, protein: 13, fat: 23, carbs: 20 },
    },
    {
        name: 'Classic Banana Bread',
        servings: 10,
        ingredients: [
            '3 ripe bananas', '2 cups flour', '3/4 cup sugar', '1/3 cup melted butter',
            '2 eggs', '1 teaspoon vanilla extract', '1 teaspoon baking soda', '1/4 teaspoon salt',
        ],
        ref: { calories: 250, protein: 4, fat: 8, carbs: 42 },
    },
];

// ─── Test 1: Nutrition Analysis Accuracy ──────────────────────────────────
async function testNutrition() {
    console.log('\n' + '═'.repeat(64));
    console.log('  TEST 1 — NUTRITION ANALYSIS ACCURACY (vs Gemini/USDA)');
    console.log('═'.repeat(64));

    let pass = 0, fail = 0;

    for (const r of RECIPES) {
        console.log(`\n📋  ${r.name} (${r.servings} servings)`);
        const t0 = Date.now();

        const result = await api('/nutrition/analyze', {
            method: 'POST',
            body: JSON.stringify({ ingredients: r.ingredients }),
        });

        const elapsed = Date.now() - t0;
        const { total, breakdown } = result;

        const ps = {
            calories: Math.round(total.calories / r.servings),
            protein:  Math.round(total.protein  / r.servings),
            fat:      Math.round(total.fat      / r.servings),
            carbs:    Math.round(total.carbs    / r.servings),
        };
        const ref = r.ref;

        console.log(`  Macro        Ours   Real   Diff`);
        console.log(`  ${'─'.repeat(38)}`);
        for (const [k, label] of [['calories','Calories'],['protein','Protein g'],['fat','Fat g'],['carbs','Carbs g']] as [string,string][]) {
            const g = (ps as any)[k], e = (ref as any)[k];
            const b = badge(g, e);
            if (b === '✅') pass++; else fail++;
            console.log(`  ${b}  ${label.padEnd(10)} ${String(g).padStart(5)}  ${String(e).padStart(5)}  ${diff(g, e).padStart(6)}`);
        }

        const found = breakdown.filter((i: any) => i.status !== 'not_found').length;
        const notFound = breakdown.filter((i: any) => i.status === 'not_found').map((i: any) => i.ingredient);
        console.log(`  Coverage: ${found}/${breakdown.length}  (${elapsed}ms)`);
        if (notFound.length) console.log(`  Missing: ${notFound.map((s: string) => s.slice(0,25)).join(', ')}`);
    }

    console.log(`\n  Result: ${pass} checks pass, ${fail} fail\n`);
    return { pass, fail };
}

// ─── Test 2: Search Quality ────────────────────────────────────────────────
async function testSearch() {
    console.log('═'.repeat(64));
    console.log('  TEST 2 — SEARCH QUALITY AUDIT');
    console.log('═'.repeat(64));

    const queries = [
        { q: 'pasta',     minResults: 5,  expectWord: 'pasta' },
        { q: 'chocolate cake', minResults: 3, expectWord: 'chocolate' },
        { q: 'grilled chicken', minResults: 3, expectWord: 'chicken' },
        { q: 'vegan salad', minResults: 1, expectWord: undefined },
        { q: 'banana bread', minResults: 1, expectWord: 'banana' },
    ];

    let pass = 0, fail = 0;

    for (const { q, minResults, expectWord } of queries) {
        const t0 = Date.now();
        const result = await api(`/search?q=${encodeURIComponent(q)}`);
        const elapsed = Date.now() - t0;
        const count = result.recipes?.length ?? 0;

        const ok = count >= minResults;
        const wordOk = !expectWord || result.recipes?.some((r: any) =>
            r.name?.toLowerCase().includes(expectWord));
        const b = (ok && wordOk) ? '✅' : '❌';
        if (b === '✅') pass++; else fail++;

        console.log(`\n  ${b}  "${q}"`);
        console.log(`     Returned ${count} results (${elapsed}ms)`);
        if (count > 0) {
            console.log(`     Top: ${result.recipes.slice(0,3).map((r: any) => r.name?.slice(0,30)).join(' | ')}`);
        }
        if (!ok)     console.log(`     ❌ Expected ≥${minResults} results, got ${count}`);
        if (!wordOk) console.log(`     ❌ Expected "${expectWord}" in at least one result`);
    }

    console.log(`\n  Result: ${pass} checks pass, ${fail} fail\n`);
    return { pass, fail };
}

// ─── Test 3: Database QA Audit ─────────────────────────────────────────────
async function testDbQuality() {
    console.log('═'.repeat(64));
    console.log('  TEST 3 — DATABASE HEALTH CHECK');
    console.log('═'.repeat(64));

    const health = await fetch(BASE + '/health').then(r => r.json());
    const { total, verified, flagged, avg_score } = health.stats;
    const quarantined = total - verified - flagged;

    console.log(`\n  Total recipes:   ${total.toLocaleString()}`);
    console.log(`  Verified:        ${verified.toLocaleString()} (${((verified/total)*100).toFixed(1)}%)`);
    console.log(`  Flagged:         ${flagged.toLocaleString()} (${((flagged/total)*100).toFixed(1)}%)`);
    console.log(`  Quarantined:     ${quarantined.toLocaleString()} (${((quarantined/total)*100).toFixed(1)}%)`);
    console.log(`  Avg quality:     ${avg_score.toFixed(1)}/100`);

    let pass = 0, fail = 0;

    const checks = [
        { label: 'Verified rate ≥ 60%',      ok: verified/total >= 0.60 },
        { label: 'Avg quality score ≥ 90',    ok: avg_score >= 90 },
        { label: 'Quarantine rate ≤ 20%',     ok: quarantined/total <= 0.20 },
    ];

    console.log();
    for (const { label, ok } of checks) {
        console.log(`  ${ok ? '✅' : '❌'}  ${label}`);
        if (ok) pass++; else fail++;
    }

    // Spot-check a real recipe by ID
    const sample = health.recent?.[0];
    if (sample) {
        const recipe = await api(`/recipes/${sample.id}`);
        const hasIngredients = Array.isArray(recipe.recipe_ingredients) && recipe.recipe_ingredients.length > 0;
        const hasInstructions = Array.isArray(recipe.recipe_instructions) && recipe.recipe_instructions.length > 0;
        console.log(`\n  Spot-check recipe: "${sample.name.slice(0,45)}"`);
        console.log(`  ${hasIngredients ? '✅' : '❌'}  Has ingredients (${recipe.recipe_ingredients?.length ?? 0})`);
        console.log(`  ${hasInstructions ? '✅' : '❌'}  Has instructions (${recipe.recipe_instructions?.length ?? 0})`);
        console.log(`  ${recipe.image ? '✅' : '❌'}  Has image`);
        if (hasIngredients) pass++; else fail++;
        if (hasInstructions) pass++; else fail++;
    }

    console.log(`\n  Result: ${pass} checks pass, ${fail} fail\n`);
    return { pass, fail };
}

// ─── Run all ───────────────────────────────────────────────────────────────
(async () => {
    console.log(`\nTarget: ${BASE}`);
    console.log(`API Key: ${KEY.slice(0, 10)}...`);

    const t1 = await testNutrition();
    const t2 = await testSearch();
    const t3 = await testDbQuality();

    const totalPass = t1.pass + t2.pass + t3.pass;
    const totalFail = t1.fail + t2.fail + t3.fail;
    const total = totalPass + totalFail;

    console.log('═'.repeat(64));
    console.log(`  FINAL SCORE: ${totalPass}/${total} checks passed`);
    if (totalFail === 0) {
        console.log('  ✅  All checks passed — API is healthy');
    } else {
        console.log(`  ❌  ${totalFail} check(s) failed — see report above`);
    }
    console.log('═'.repeat(64) + '\n');

    process.exit(totalFail > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
