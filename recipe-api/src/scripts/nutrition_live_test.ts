/**
 * Live nutrition accuracy test — calls real USDA/FatSecret APIs with 3 canonical recipes.
 * Run: npx ts-node src/scripts/nutrition_live_test.ts
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { NutritionEngine } from '../services/nutritionEngine';

interface Reference {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  source: string;
}

interface Recipe {
  name: string;
  servings: number;
  ingredients: string[];
  reference: Reference;
}

const RECIPES: Recipe[] = [
  {
    name: 'Classic Spaghetti Bolognese',
    servings: 4,
    ingredients: [
      '400g spaghetti',
      '500g ground beef',
      '1 medium onion',
      '3 cloves garlic',
      '400g canned tomatoes',
      '2 tablespoons olive oil',
      '1 teaspoon salt',
      '1 teaspoon black pepper',
      '1 teaspoon dried oregano',
    ],
    reference: { calories: 650, protein: 35, fat: 18, carbs: 82, source: 'USDA/Nutritionix avg (4 servings)' },
  },
  {
    name: 'Caesar Salad',
    servings: 2,
    ingredients: [
      '1 large romaine lettuce',
      '2 tablespoons olive oil',
      '1 tablespoon lemon juice',
      '1 teaspoon Worcestershire sauce',
      '1 clove garlic',
      '30g parmesan cheese',
      '30g croutons',
      '1 egg yolk',
    ],
    reference: { calories: 290, protein: 8, fat: 22, carbs: 14, source: 'USDA/MyFitnessPal avg (2 servings)' },
  },
  {
    name: 'Classic Banana Bread',
    servings: 10,
    ingredients: [
      '3 ripe bananas',
      '2 cups flour',
      '3/4 cup sugar',
      '1/3 cup melted butter',
      '2 eggs',
      '1 teaspoon vanilla extract',
      '1 teaspoon baking soda',
      '1/4 teaspoon salt',
    ],
    reference: { calories: 220, protein: 4, fat: 7, carbs: 37, source: 'USDA/AllRecipes avg (10 slices)' },
  },
];

function diffStr(got: number, expected: number): string {
  const diff = ((got - expected) / expected) * 100;
  return (diff > 0 ? '+' : '') + diff.toFixed(0) + '%';
}

function badge(got: number, expected: number): string {
  const diff = Math.abs(got - expected) / expected;
  if (diff <= 0.10) return '✅';
  if (diff <= 0.25) return '⚠️ ';
  return '❌';
}

function row(label: string, got: number, exp: number): string {
  const b = badge(got, exp);
  return `  ${b}  ${label.padEnd(12)} ${String(got).padStart(6)}  ${String(exp).padStart(6)}  ${diffStr(got, exp).padStart(8)}`;
}

async function runTests() {
  console.log('\n' + '='.repeat(62));
  console.log('  RECIPE BASE — LIVE NUTRITION ACCURACY AUDIT');
  console.log('='.repeat(62));

  const summary: { name: string; calBadge: string; elapsed: number; coverage: string }[] = [];

  for (const recipe of RECIPES) {
    console.log(`\n${'─'.repeat(62)}`);
    console.log(`📋  ${recipe.name}  (${recipe.servings} servings)`);
    console.log(`${'─'.repeat(62)}`);
    console.log(`Analyzing ${recipe.ingredients.length} ingredients in parallel...\n`);

    const start = Date.now();
    let result: Awaited<ReturnType<typeof NutritionEngine.analyze>>;
    try {
      result = await NutritionEngine.analyze(recipe.ingredients);
    } catch (e: any) {
      console.error(`  FAILED: ${e.message}`);
      continue;
    }
    const elapsed = Date.now() - start;

    const { total, breakdown } = result;

    const perServing = {
      calories: Math.round(total.calories / recipe.servings),
      protein:  Math.round(total.protein  / recipe.servings),
      fat:      Math.round(total.fat      / recipe.servings),
      carbs:    Math.round(total.carbs    / recipe.servings),
    };

    const ref = recipe.reference;

    console.log(`  Per-serving vs reference (${ref.source})`);
    console.log(`       Macro       Ours    Real       Diff`);
    console.log(`  ${'─'.repeat(50)}`);
    console.log(row('Calories', perServing.calories, ref.calories));
    console.log(row('Protein g', perServing.protein, ref.protein));
    console.log(row('Fat g', perServing.fat, ref.fat));
    console.log(row('Carbs g', perServing.carbs, ref.carbs));

    // Ingredient breakdown
    console.log(`\n  Ingredient breakdown  (total time: ${elapsed}ms)`);
    let found = 0;
    let notFound = 0;
    for (const item of breakdown) {
      if (item.status === 'not_found') {
        notFound++;
        console.log(`  ❌  NOT FOUND: ${item.ingredient}`);
      } else {
        found++;
        const cal = Math.round(item.stats?.calories ?? 0);
        const src = (item.source === 'usda' ? 'USDA     ' : 'FatSecret');
        const nm  = String(item.parsed?.name ?? item.ingredient).slice(0, 35).padEnd(35);
        console.log(`  ✓  ${nm} ${String(cal).padStart(4)} kcal  [${src}]`);
      }
    }
    const coverage = `${found}/${breakdown.length}`;
    console.log(`\n  Coverage: ${coverage} ingredients found`);

    summary.push({ name: recipe.name, calBadge: badge(perServing.calories, ref.calories), elapsed, coverage });
  }

  console.log('\n' + '='.repeat(62));
  console.log('  SUMMARY');
  console.log('='.repeat(62));
  for (const s of summary) {
    console.log(`  ${s.calBadge}  ${s.name.padEnd(38)} ${s.elapsed}ms  cov=${s.coverage}`);
  }
  console.log('='.repeat(62) + '\n');
}

runTests().catch(console.error);
