/**
 * Deep 20-Recipe Nutrition Accuracy Audit with Gemini CLI cross-reference
 *
 * For each of 20 canonical recipes:
 *   1. Calls our /nutrition/analyze API
 *   2. Queries the Gemini CLI (with web search) for reference calorie count
 *   3. Compares results and reports discrepancies with patterns
 *
 * Usage:
 *   API_KEY=sk_... npx ts-node src/scripts/deep_audit_20.ts
 */

import { execSync } from 'child_process';

const BASE    = 'https://recipe-base.wearemachina.com';
const API_KEY = process.env.API_KEY || '';

if (!API_KEY) { console.error('Set API_KEY env var'); process.exit(1); }

// ─── 20 canonical test recipes ─────────────────────────────────────────────
// Each has well-documented authoritative reference values (per-serving).
// References sourced from: USDA, Allrecipes, Serious Eats, BBC Good Food.

const RECIPES = [
    // ── Breakfast ────────────────────────────────────────────────────────────
    {
        name: 'Classic Buttermilk Pancakes',
        servings: 4,
        ingredients: [
            '2 cups all-purpose flour',
            '2 tablespoons sugar',
            '2 teaspoons baking powder',
            '1 teaspoon baking soda',
            '1/2 teaspoon salt',
            '2 cups buttermilk',
            '2 eggs',
            '2 tablespoons melted butter',
        ],
        ref_per_serving: 320,
        notes: 'Standard buttermilk pancake (4 pancakes), USDA + Allrecipes',
    },
    {
        name: 'Scrambled Eggs with Butter',
        servings: 1,
        ingredients: [
            '3 large eggs',
            '1 tablespoon butter',
            '2 tablespoons milk',
            '1/4 teaspoon salt',
        ],
        ref_per_serving: 280,
        notes: 'USDA standard scrambled eggs',
    },
    {
        name: 'Classic Oatmeal with Banana',
        servings: 1,
        ingredients: [
            '1/2 cup rolled oats',
            '1 cup water',
            '1 medium banana',
            '1 tablespoon honey',
            '1/4 teaspoon cinnamon',
        ],
        ref_per_serving: 320,
        notes: 'USDA oats + banana + honey',
    },
    {
        name: 'Avocado Toast',
        servings: 1,
        ingredients: [
            '2 slices whole wheat bread',
            '1 medium avocado',
            '1 tablespoon lemon juice',
            '1/4 teaspoon salt',
            '1/4 teaspoon red pepper flakes',
        ],
        ref_per_serving: 380,
        notes: 'USDA + common nutrition trackers',
    },
    // ── Lunch / Light ────────────────────────────────────────────────────────
    {
        name: 'Classic Caesar Salad',
        servings: 2,
        ingredients: [
            '1 large head romaine lettuce',
            '30g parmesan cheese',
            '40g croutons',
            '3 tablespoons olive oil',
            '1 tablespoon lemon juice',
            '1 egg yolk',
            '2 cloves garlic',
            '1 teaspoon Worcestershire sauce',
            '1 teaspoon Dijon mustard',
        ],
        ref_per_serving: 360,
        notes: 'Serious Eats Caesar Salad reference',
    },
    {
        name: 'BLT Sandwich',
        servings: 1,
        ingredients: [
            '2 slices white bread',
            '3 strips bacon',
            '2 leaves lettuce',
            '1 medium tomato sliced',
            '1 tablespoon mayonnaise',
        ],
        ref_per_serving: 430,
        notes: 'Classic BLT — USDA + Allrecipes',
    },
    {
        name: 'Chicken Noodle Soup',
        servings: 4,
        ingredients: [
            '500g chicken breast',
            '2 cups egg noodles',
            '3 medium carrots',
            '3 stalks celery',
            '1 medium onion',
            '2 cloves garlic',
            '6 cups chicken broth',
            '1 tablespoon olive oil',
            '1 teaspoon dried thyme',
            '1 teaspoon salt',
            '1/2 teaspoon black pepper',
        ],
        ref_per_serving: 300,
        notes: 'Allrecipes classic chicken noodle soup',
    },
    {
        name: 'Greek Salad',
        servings: 2,
        ingredients: [
            '2 medium tomatoes',
            '1 medium cucumber',
            '1/2 medium red onion',
            '100g feta cheese',
            '80g kalamata olives',
            '2 tablespoons olive oil',
            '1 tablespoon red wine vinegar',
            '1 teaspoon dried oregano',
        ],
        ref_per_serving: 320,
        notes: 'BBC Good Food Greek Salad',
    },
    // ── Dinner / Main ────────────────────────────────────────────────────────
    {
        name: 'Spaghetti Bolognese',
        servings: 4,
        ingredients: [
            '400g spaghetti',
            '500g ground beef',
            '1 medium onion',
            '3 cloves garlic',
            '400g canned diced tomatoes',
            '2 tablespoons olive oil',
            '1 teaspoon dried oregano',
            '1 teaspoon salt',
            '1/2 teaspoon black pepper',
        ],
        ref_per_serving: 780,
        notes: 'Serious Eats Bolognese reference',
    },
    {
        name: 'Grilled Chicken Breast with Vegetables',
        servings: 2,
        ingredients: [
            '2 boneless skinless chicken breasts (about 300g each)',
            '1 medium zucchini',
            '1 red bell pepper',
            '1 medium onion',
            '2 tablespoons olive oil',
            '1 teaspoon garlic powder',
            '1 teaspoon paprika',
            '1/2 teaspoon salt',
        ],
        ref_per_serving: 380,
        notes: 'USDA grilled chicken + roasted veg',
    },
    {
        name: 'Beef Tacos',
        servings: 3,
        ingredients: [
            '400g ground beef',
            '6 corn tortillas',
            '1/2 cup shredded cheddar cheese',
            '1 medium tomato diced',
            '1/2 head iceberg lettuce shredded',
            '1/4 cup sour cream',
            '1 tablespoon taco seasoning',
            '1 tablespoon vegetable oil',
        ],
        ref_per_serving: 520,
        notes: 'Allrecipes beef tacos (2 tacos per serving)',
    },
    {
        name: 'Vegetable Stir-Fry with Rice',
        servings: 2,
        ingredients: [
            '1 cup white rice',
            '1 medium broccoli head',
            '2 medium carrots',
            '1 red bell pepper',
            '1 cup snap peas',
            '3 tablespoons soy sauce',
            '1 tablespoon sesame oil',
            '2 cloves garlic',
            '1 teaspoon fresh ginger',
            '1 tablespoon vegetable oil',
        ],
        ref_per_serving: 420,
        notes: 'BBC Good Food vegetable stir-fry with rice',
    },
    {
        name: 'Margherita Pizza',
        servings: 4,
        ingredients: [
            '300g pizza dough',
            '150g mozzarella cheese',
            '200g tomato sauce',
            '10 fresh basil leaves',
            '2 tablespoons olive oil',
            '1/2 teaspoon salt',
        ],
        ref_per_serving: 460,
        notes: 'Standard 12-inch Margherita pizza slice',
    },
    {
        name: 'Chicken Fried Rice',
        servings: 3,
        ingredients: [
            '3 cups cooked white rice',
            '250g chicken breast diced',
            '2 eggs',
            '1 cup frozen peas and carrots',
            '3 tablespoons soy sauce',
            '1 tablespoon sesame oil',
            '2 cloves garlic',
            '2 tablespoons vegetable oil',
            '3 green onions',
        ],
        ref_per_serving: 480,
        notes: 'Allrecipes chicken fried rice',
    },
    {
        name: 'Lentil Soup',
        servings: 4,
        ingredients: [
            '2 cups red lentils',
            '1 medium onion',
            '3 cloves garlic',
            '2 medium carrots',
            '1 can diced tomatoes',
            '4 cups vegetable broth',
            '2 tablespoons olive oil',
            '1 teaspoon cumin',
            '1 teaspoon turmeric',
            '1/2 teaspoon paprika',
            '1 teaspoon salt',
        ],
        ref_per_serving: 310,
        notes: 'BBC Good Food red lentil soup',
    },
    {
        name: 'Salmon with Roasted Asparagus',
        servings: 2,
        ingredients: [
            '2 salmon fillets (170g each)',
            '1 bunch asparagus (about 400g)',
            '2 tablespoons olive oil',
            '2 cloves garlic',
            '1 lemon sliced',
            '1/2 teaspoon salt',
            '1/2 teaspoon black pepper',
            '1 tablespoon fresh dill',
        ],
        ref_per_serving: 450,
        notes: 'USDA salmon + asparagus',
    },
    // ── Baked / Desserts ─────────────────────────────────────────────────────
    {
        name: 'Classic Banana Bread',
        servings: 10,
        ingredients: [
            '3 ripe bananas mashed',
            '2 cups all-purpose flour',
            '3/4 cup sugar',
            '1/3 cup melted butter',
            '2 eggs',
            '1 teaspoon vanilla extract',
            '1 teaspoon baking soda',
            '1/4 teaspoon salt',
        ],
        ref_per_serving: 250,
        notes: 'Allrecipes banana bread — 10 slices',
    },
    {
        name: 'Chocolate Chip Cookies',
        servings: 24,
        ingredients: [
            '2 1/4 cups all-purpose flour',
            '1 teaspoon baking soda',
            '1 teaspoon salt',
            '1 cup butter softened',
            '3/4 cup granulated sugar',
            '3/4 cup packed brown sugar',
            '2 large eggs',
            '2 teaspoons vanilla extract',
            '2 cups chocolate chips',
        ],
        ref_per_serving: 160,
        notes: 'Toll House original — 24 cookies',
    },
    // ── Snack / Other ────────────────────────────────────────────────────────
    {
        name: 'Guacamole with Tortilla Chips',
        servings: 4,
        ingredients: [
            '3 medium avocados',
            '1 lime juiced',
            '1 medium tomato diced',
            '1/4 medium red onion diced',
            '2 tablespoons fresh cilantro',
            '1 jalapeño minced',
            '1/2 teaspoon salt',
            '200g tortilla chips',
        ],
        ref_per_serving: 380,
        notes: 'Guacamole + chips (50g chips/serving)',
    },
    {
        name: 'Tomato Basil Pasta',
        servings: 4,
        ingredients: [
            '400g penne pasta',
            '400g cherry tomatoes halved',
            '4 cloves garlic',
            '4 tablespoons olive oil',
            '1 bunch fresh basil',
            '50g parmesan cheese',
            '1 teaspoon salt',
            '1/2 teaspoon red pepper flakes',
        ],
        ref_per_serving: 520,
        notes: 'Simple pasta with fresh tomato — no meat',
    },
];

// ─── API helper ──────────────────────────────────────────────────────────────

async function analyzeRecipe(ingredients: string[]): Promise<any> {
    const res = await fetch(`${BASE}/nutrition/analyze`, {
        method: 'POST',
        headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
}

// ─── Gemini CLI query ─────────────────────────────────────────────────────────

function queryGemini(recipeName: string, ingredients: string[]): number {
    const ingredientList = ingredients.map(i => `  - ${i}`).join('\n');
    const prompt = [
        `I need the total calorie count for this recipe from authoritative sources like USDA, AllRecipes, or nutrition databases.`,
        `Recipe: "${recipeName}"`,
        `Ingredients:`,
        ingredientList,
        ``,
        `Search Google/web for the calorie information and return ONLY a JSON object on a single line with no markdown, no explanation, just this exact format:`,
        `{"total_calories": <number>, "calories_per_serving": <number>, "servings": <number>, "source": "<site name>"}`,
        ``,
        `If you cannot find exact data, calculate from USDA data. Output ONLY the JSON.`,
    ].join('\n');

    try {
        // Write prompt to temp file to avoid shell escaping issues
        const tmpFile = `/tmp/gemini_prompt_${Date.now()}.txt`;
        require('fs').writeFileSync(tmpFile, prompt);

        const output = execSync(
            `gemini --yolo < "${tmpFile}"`,
            {
                timeout: 60000,
                encoding: 'utf-8',
                env: { ...process.env, HOME: process.env.HOME, GEMINI_CLI_TRUST_WORKSPACE: 'true' },
            }
        ).trim();

        require('fs').unlinkSync(tmpFile);

        // Extract JSON from the response (might have surrounding text)
        const jsonMatch = output.match(/\{[^{}]*"total_calories"[^{}]*\}/);
        if (!jsonMatch) {
            console.error(`  [Gemini] No JSON found in response for ${recipeName}. Raw: ${output.slice(0, 200)}`);
            return -1;
        }

        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.total_calories || parsed.calories_per_serving * (parsed.servings || 1) || -1;
    } catch (e: any) {
        console.error(`  [Gemini] Error for ${recipeName}: ${e.message?.slice(0, 100)}`);
        return -1;
    }
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function badge(our: number, ref: number): string {
    const d = Math.abs(our - ref) / ref;
    if (d <= 0.10) return '✅';
    if (d <= 0.25) return '⚠️ ';
    return '❌';
}

function pct(our: number, ref: number): string {
    const d = ((our - ref) / ref) * 100;
    return (d > 0 ? '+' : '') + d.toFixed(0) + '%';
}

// ─── Main audit ───────────────────────────────────────────────────────────────

interface AuditResult {
    name: string;
    servings: number;
    our_total: number;
    our_per_serving: number;
    ref_per_serving: number;
    gemini_total: number;
    gemini_per_serving: number;
    vs_hardcoded: string;
    vs_gemini: string;
    coverage_pct: number;
    breakdown_issues: string[];
    notes: string;
}

(async () => {
    console.log('\n' + '═'.repeat(72));
    console.log('  DEEP 20-RECIPE NUTRITION AUDIT  —  Gemini CLI × API Cross-Reference');
    console.log('═'.repeat(72));
    console.log(`  Target: ${BASE}`);
    console.log(`  Date: ${new Date().toISOString()}`);
    console.log(`  Recipes: ${RECIPES.length}`);
    console.log('═'.repeat(72) + '\n');

    const results: AuditResult[] = [];
    const discrepancyPatterns: Record<string, string[]> = {};

    for (let i = 0; i < RECIPES.length; i++) {
        const recipe = RECIPES[i];
        console.log(`\n[${i + 1}/${RECIPES.length}] ${recipe.name}`);
        console.log(`  Ingredients: ${recipe.ingredients.length}  |  Servings: ${recipe.servings}`);

        // Step 1: Our API
        let apiResult: any;
        try {
            apiResult = await analyzeRecipe(recipe.ingredients);
        } catch (e: any) {
            console.error(`  API error: ${e.message}`);
            continue;
        }

        const ourTotal = Math.round(apiResult.total?.calories || 0);
        const ourPerServing = Math.round(ourTotal / recipe.servings);
        const coverage = apiResult.breakdown
            ? Math.round((apiResult.breakdown.filter((b: any) => b.status !== 'not_found').length / apiResult.breakdown.length) * 100)
            : 100;

        console.log(`  Our API:  ${ourTotal} kcal total  →  ${ourPerServing} kcal/serving  (coverage: ${coverage}%)`);

        // Step 2: Gemini CLI web search
        process.stdout.write(`  Gemini:   querying web... `);
        const geminiTotal = queryGemini(recipe.name, recipe.ingredients);
        const geminiPerServing = geminiTotal > 0 ? Math.round(geminiTotal / recipe.servings) : -1;

        if (geminiTotal > 0) {
            console.log(`${geminiTotal} kcal total  →  ${geminiPerServing} kcal/serving`);
        } else {
            console.log('(no result)');
        }

        // Step 3: Compare against hardcoded reference
        const vsRef = badge(ourPerServing, recipe.ref_per_serving);
        const vsRefPct = pct(ourPerServing, recipe.ref_per_serving);
        console.log(`  vs Ref:   ${vsRef} ${ourPerServing} vs ${recipe.ref_per_serving} kcal/srv  (${vsRefPct})`);

        // Compare against Gemini
        let vsGemini = 'N/A';
        if (geminiTotal > 0) {
            const gb = badge(ourTotal, geminiTotal);
            const gp = pct(ourTotal, geminiTotal);
            vsGemini = `${gb} ${gp}`;
            console.log(`  vs Gemini:${vsGemini}  (${ourTotal} vs ${geminiTotal} kcal total)`);
        }

        // Step 4: Detect ingredient-level issues
        const issues: string[] = [];
        if (apiResult.breakdown) {
            for (const item of apiResult.breakdown) {
                if (item.status === 'not_found') {
                    issues.push(`missing: ${item.ingredient?.slice(0, 40)}`);
                }
                // Flag ingredients contributing >40% of total
                if (ourTotal > 0 && item.calories && (item.calories / ourTotal) > 0.40) {
                    issues.push(`dominant (${Math.round(item.calories/ourTotal*100)}%): ${item.ingredient?.slice(0,35)}`);
                }
            }
        }
        if (issues.length) console.log(`  Issues:   ${issues.join('  |  ')}`);

        // Pattern detection
        const errorPct = ourPerServing > 0 && recipe.ref_per_serving > 0
            ? Math.abs(ourPerServing - recipe.ref_per_serving) / recipe.ref_per_serving
            : -1;

        if (errorPct > 0.25) {
            const direction = ourPerServing > recipe.ref_per_serving ? 'OVER' : 'UNDER';
            const patternKey = `${direction} >25%`;
            if (!discrepancyPatterns[patternKey]) discrepancyPatterns[patternKey] = [];
            discrepancyPatterns[patternKey].push(`${recipe.name} (${vsRefPct})`);
        }

        results.push({
            name: recipe.name,
            servings: recipe.servings,
            our_total: ourTotal,
            our_per_serving: ourPerServing,
            ref_per_serving: recipe.ref_per_serving,
            gemini_total: geminiTotal,
            gemini_per_serving: geminiPerServing,
            vs_hardcoded: `${vsRef} ${vsRefPct}`,
            vs_gemini: vsGemini,
            coverage_pct: coverage,
            breakdown_issues: issues,
            notes: recipe.notes,
        });

        // Throttle between recipes
        await new Promise(r => setTimeout(r, 800));
    }

    // ─── Final summary ──────────────────────────────────────────────────────

    console.log('\n\n' + '═'.repeat(72));
    console.log('  SUMMARY TABLE');
    console.log('═'.repeat(72));
    console.log(`  ${'Recipe'.padEnd(36)} ${'Ours'.padStart(6)} ${'Ref'.padStart(6)} ${'Diff'.padStart(7)}  ${'Gemini'.padStart(8)}`);
    console.log('  ' + '─'.repeat(70));

    let pass10 = 0, pass25 = 0, fail25 = 0;
    for (const r of results) {
        const d = (r.our_per_serving - r.ref_per_serving) / r.ref_per_serving;
        const b = Math.abs(d) <= 0.10 ? '✅' : Math.abs(d) <= 0.25 ? '⚠️ ' : '❌';
        const diffStr = pct(r.our_per_serving, r.ref_per_serving);
        const geminiStr = r.gemini_per_serving > 0 ? String(r.gemini_per_serving) : 'N/A';
        console.log(`  ${b} ${r.name.slice(0, 34).padEnd(34)} ${String(r.our_per_serving).padStart(6)} ${String(r.ref_per_serving).padStart(6)} ${diffStr.padStart(7)}  ${geminiStr.padStart(8)}`);

        if (Math.abs(d) <= 0.10) pass10++;
        else if (Math.abs(d) <= 0.25) pass25++;
        else fail25++;
    }

    console.log('\n  ' + '─'.repeat(70));
    console.log(`  ✅ Within 10%:  ${pass10}/${results.length}`);
    console.log(`  ⚠️  Within 25%:  ${pass25}/${results.length}`);
    console.log(`  ❌ Over 25%:    ${fail25}/${results.length}`);
    console.log(`  Overall accuracy (±25%): ${Math.round((pass10 + pass25) / results.length * 100)}%`);

    // ─── Discrepancy patterns ──────────────────────────────────────────────

    if (Object.keys(discrepancyPatterns).length) {
        console.log('\n\n' + '═'.repeat(72));
        console.log('  DISCREPANCY PATTERNS');
        console.log('═'.repeat(72));
        for (const [pattern, recipes] of Object.entries(discrepancyPatterns)) {
            console.log(`\n  ${pattern}:`);
            recipes.forEach(r => console.log(`    • ${r}`));
        }
    }

    // ─── Ingredient-level breakdown analysis ──────────────────────────────

    const allIssues = results.flatMap(r => r.breakdown_issues);
    if (allIssues.length) {
        console.log('\n\n' + '═'.repeat(72));
        console.log('  INGREDIENT-LEVEL ISSUES DETECTED');
        console.log('═'.repeat(72));
        allIssues.forEach(i => console.log(`  • ${i}`));
    }

    // ─── Gemini vs Our API agreement ──────────────────────────────────────

    const geminiComparable = results.filter(r => r.gemini_total > 0);
    if (geminiComparable.length) {
        console.log('\n\n' + '═'.repeat(72));
        console.log('  GEMINI (WEB SEARCH) vs OUR API');
        console.log('═'.repeat(72));
        let agree = 0;
        for (const r of geminiComparable) {
            const d = Math.abs(r.our_total - r.gemini_total) / r.gemini_total;
            const b = d <= 0.25 ? '✅' : '❌';
            if (d <= 0.25) agree++;
            const diffG = pct(r.our_total, r.gemini_total);
            console.log(`  ${b} ${r.name.slice(0,40).padEnd(40)} ours=${r.our_total} gemini=${r.gemini_total} (${diffG})`);
        }
        console.log(`\n  Agreement within 25%: ${agree}/${geminiComparable.length} (${Math.round(agree/geminiComparable.length*100)}%)`);
    }

    // ─── Save JSON report ─────────────────────────────────────────────────

    const report = {
        generatedAt: new Date().toISOString(),
        recipesAnalyzed: results.length,
        accuracy: {
            within10pct: pass10,
            within25pct: pass10 + pass25,
            over25pct: fail25,
            overallPct: Math.round((pass10 + pass25) / results.length * 100),
        },
        results,
        discrepancyPatterns,
    };

    const outFile = `deep_audit_20_${new Date().toISOString().slice(0,10)}.json`;
    require('fs').writeFileSync(outFile, JSON.stringify(report, null, 2));
    console.log(`\n\nReport saved to: ${outFile}`);

    console.log('\n' + '═'.repeat(72) + '\n');
})().catch(e => { console.error(e); process.exit(1); });
