/**
 * Broad ingredient coverage test — verifies the engine can handle
 * common, exotic, and unusual ingredients without predefined corrections.
 *
 * Usage: API_KEY=sk_... npx ts-node src/scripts/ingredient_coverage_test.ts
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const BASE = 'https://recipe-base.wearemachina.com';
const KEY  = process.env.API_KEY || '';

if (!KEY) { console.error('Set API_KEY env var'); process.exit(1); }

interface Group { label: string; ingredients: string[] }

const GROUPS: Group[] = [
  {
    label: 'Standard pantry',
    ingredients: ['200g chicken breast', '100g brown rice', '2 tablespoons olive oil',
                  '1 clove garlic', '1 medium onion'],
  },
  {
    label: 'Baking (speciality flours)',
    ingredients: ['1 cup almond flour', '1 cup coconut flour', '1 cup whole wheat flour',
                  '2 tablespoons cocoa powder', '1 teaspoon baking powder'],
  },
  {
    label: 'Asian pantry',
    ingredients: ['2 tablespoons miso paste', '1 tablespoon soy sauce',
                  '1 tablespoon sesame oil', '50g tofu', '1 tablespoon gochujang',
                  '1 tablespoon tahini'],
  },
  {
    label: 'Fresh produce (count-based)',
    ingredients: ['1 avocado', '3 stalks celery', '1 medium zucchini',
                  '1 large portobello mushroom', '2 sprigs fresh thyme',
                  '1 stalk lemongrass', '½ butternut squash'],
  },
  {
    label: 'Proteins',
    ingredients: ['150g salmon fillet', '100g ground turkey', '200g shrimp',
                  '1 can chickpeas', '100g tempeh'],
  },
  {
    label: 'Dairy & alternatives',
    ingredients: ['1 cup Greek yogurt', '100ml coconut milk', '50g feta cheese',
                  '1 cup almond milk', '2 tablespoons cream cheese'],
  },
];

async function runGroup(group: Group) {
  const res = await fetch(`${BASE}/nutrition/analyze`, {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ingredients: group.ingredients }),
  });

  const data: any = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);

  const { total, breakdown } = data;
  const found    = breakdown.filter((b: any) => b.status !== 'not_found');
  const notFound = breakdown.filter((b: any) => b.status === 'not_found');
  const pct      = Math.round(100 * found.length / breakdown.length);

  console.log(`\n  ${group.label}  (${pct}% found, ${found.length}/${breakdown.length})`);
  for (const b of breakdown) {
    if (b.status === 'not_found') {
      console.log(`    ❌  ${b.ingredient}`);
      if (b.tried?.length) console.log(`        tried: ${b.tried.join(', ')}`);
    } else {
      const cal = Math.round(b.stats?.calories ?? 0);
      const wt  = Math.round(b.parsed?.weightGrams ?? 0);
      const src = (b.source === 'usda' ? 'USDA' : 'FatSec').padEnd(6);
      console.log(`    ✓  ${b.ingredient.padEnd(35)}  ${String(wt).padStart(4)}g  ${String(cal).padStart(4)} kcal  [${src}]`);
    }
  }

  return { found: found.length, total: breakdown.length };
}

(async () => {
  console.log(`\n${'═'.repeat(70)}`);
  console.log('  INGREDIENT COVERAGE TEST — any ingredient, any weight');
  console.log('═'.repeat(70));

  let totalFound = 0, totalIngredients = 0;

  for (const group of GROUPS) {
    const { found, total } = await runGroup(group);
    totalFound      += found;
    totalIngredients += total;
  }

  const overallPct = Math.round(100 * totalFound / totalIngredients);
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  Overall coverage: ${totalFound}/${totalIngredients} (${overallPct}%)`);
  console.log(`${'═'.repeat(70)}\n`);

  process.exit(overallPct >= 70 ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
