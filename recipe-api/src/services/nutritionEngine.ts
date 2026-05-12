import { supabase } from '../supabaseClient';
import { searchUsda, UsdaNutrition } from './usda';
import { searchFatSecret, SimpleNutrition } from './fatsecret';
import { searchOpenFoodFacts, OffNutrition } from './openFoodFacts';
import { lookupBaseline } from './baselineNutrition';
import { cleanIngredientTerm, getSearchTerms } from '../utils/cleaning';
import { detectCookingState, resolveCookingState, resolveContext, getCookedDensity, CookingState, DishContext } from '../utils/cookingState';

/**
 * Returns true when the ingredient string looks like a packaged or branded product.
 * These tend to be better covered by Open Food Facts than USDA.
 */
function looksLikePackagedFood(name: string): boolean {
    const signals = /\b(can|canned|tin|tinned|jar|packet|sachet|box|carton|bottle|bag|pouch|brand|store.?bought|pre.?made|ready.?made)\b/i;
    return signals.test(name);
}

// The library exports named functions, not a default export.
const { parseIngredient } = require('parse-ingredient');

interface NutritionTotal {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    fiber: number;
    sugar: number;
    calcium_mg: number;
    iron_mg: number;
    vitamin_a_mcg: number;
    vitamin_c_mg: number;
}

// IMPORTANT: More specific keys must appear BEFORE less specific ones because
// getDensity() iterates in insertion order and returns the first substring match.
// e.g., 'cream cheese' before 'cream', 'brown sugar' before 'sugar', 'almond flour' before 'flour'.
const DENSITY_TABLE: Record<string, number> = {
    // ─── Flours & dry baking ──────────────────────────────────────────────────
    'almond flour':    0.44,  // ~104g / cup
    'coconut flour':   0.40,  // ~90g / cup
    'whole wheat flour': 0.52,
    'bread flour':     0.53,
    'cake flour':      0.48,
    'flour':           0.55,  // all-purpose: ~125g / cup
    'baking soda':     0.85,
    'baking powder':   0.75,
    'cornstarch':      0.55,
    'cornmeal':        0.60,
    'panko':           0.28,  // panko breadcrumbs: ~65g / cup (very light)
    'breadcrumb':      0.42,  // dry: ~100g / cup
    // ─── Sugars ───────────────────────────────────────────────────────────────
    'brown sugar':     0.93,  // packed: ~220g / cup
    'powdered sugar':  0.50,  // ~120g / cup
    'caster sugar':    0.85,
    'sugar':           0.85,  // granulated: ~200g / cup
    // ─── Fats & oils ──────────────────────────────────────────────────────────
    'coconut oil':     0.92,
    'shortening':      0.88,
    'lard':            0.96,
    'butter':          0.96,  // ~227g / cup
    'oil':             0.92,  // vegetable/olive: ~216g / cup
    // ─── Grains, seeds & legumes (dry, uncooked) ─────────────────────────────
    'rolled oats':     0.40,
    'quick oats':      0.40,
    'oats':            0.40,  // ~95g / cup
    'bulgur':          0.70,
    'millet':          0.80,
    'wheat berries':   0.80,
    'quinoa':          0.75,
    'couscous':        0.60,
    'rice':            0.85,  // raw: ~185g / cup
    'chia seeds':      0.69,
    'flaxseed':        0.62,
    'sesame seeds':    0.60,
    'pepitas':         0.59,  // shelled pumpkin seeds: 1 cup ≈ 140g
    'pumpkin seeds':   0.58,
    'sunflower seeds': 0.55,
    'pine nuts':       0.58,
    'peanuts':         0.58,
    'cashews':         0.57,
    'almonds':         0.55,
    'pecans':          0.42,
    'walnuts':         0.45,
    'nuts':            0.55,  // chopped mixed nuts
    // ─── Puffed / airy foods — critical for accuracy ─────────────────────────
    // These are FAR less dense than water; defaulting to water = 30–70x overcount
    'popcorn':         0.034, // popped: ~8g / cup — the most error-prone ingredient
    'puffed rice':     0.025, // ~6g / cup
    'puffed wheat':    0.025,
    'corn puffs':      0.04,
    'cornflakes':      0.12,  // ~28g / cup
    'cereal':          0.10,  // generic dry cereal
    'granola':         0.52,  // ~122g / cup
    // ─── Dairy & alternatives ─────────────────────────────────────────────────
    'cream cheese':    0.97,  // ~230g / cup (softened)
    'sour cream':      0.97,
    'coconut milk':    0.96,  // full-fat canned: ~227g / cup
    'almond milk':     1.04,
    'oat milk':        1.03,
    'buttermilk':      1.03,
    'yogurt':          1.04,  // ~245g / cup
    'cream':           1.01,  // heavy cream: ~238g / cup
    'milk':            1.03,  // whole milk: ~244g / cup
    // ─── Condiments, pastes & thick liquids ──────────────────────────────────
    'peanut butter':   1.09,  // smooth: ~258g / cup
    'almond butter':   1.09,
    'nut butter':      1.09,
    'tahini':          1.02,  // ~240g / cup
    'miso':            1.08,
    'tomato paste':    1.15,
    'ketchup':         1.15,
    'mayonnaise':      0.93,
    'hummus':          1.03,
    'salsa':           1.03,
    // ─── Sweeteners & syrups ─────────────────────────────────────────────────
    'maple syrup':     1.35,
    'corn syrup':      1.38,
    'agave':           1.35,
    'honey':           1.42,
    'molasses':        1.40,
    'syrup':           1.35,
    // ─── Beverages & cooking liquids ─────────────────────────────────────────
    'broth':           1.0,
    'stock':           1.0,
    'wine':            1.0,
    'vinegar':         1.01,
    'beer':            1.0,
    'juice':           1.04,
    'water':           1.0,
    // ─── Cocoa & chocolate ───────────────────────────────────────────────────
    'cocoa':           0.45,  // unsweetened powder: ~85g / cup
    // ─── Cheese (grated/crumbled, measured by volume) ────────────────────────
    'parmesan':        0.25,  // finely grated: ~100g / cup (very light)
    'feta':            0.44,  // crumbled: ~105g / cup
    'cheese':          0.45,  // generic shredded/grated loosely
    // ─── Alcoholic beverages (~0.94 g/ml for 40% ABV spirits) ───────────────
    // Water density (1.0) overcounts spirits: 2 cups whiskey → 473g not 447g (~6% error).
    // More importantly it must match an eviction threshold, so explicit density helps.
    'whiskey':         0.94,
    'whisky':          0.94,
    'bourbon':         0.94,
    'vodka':           0.94,
    'gin':             0.92,
    'rum':             0.94,
    'tequila':         0.93,
    'brandy':          0.94,
    'cognac':          0.94,
    'schnapps':        0.94,
    'liqueur':         1.10,  // liqueurs are sweeter/denser
    // ─── Fresh produce (loosely packed leaves / shredded) ────────────────────
    'cabbage':         0.38,  // shredded: ~90g / cup
    'bok choy':        0.15,  // shredded
    'kale':            0.15,  // torn leaves
    'arugula':         0.10,
    'spinach':         0.12,  // raw baby leaves: ~28g / cup
    'lettuce':         0.08,  // loosely packed leaves: ~20g / cup
    // ─── Chopped / sliced vegetables — critical for volume measurements ───────
    // Without these, USDA density defaults to water (1.0 g/ml) causing 2-3× weight errors.
    // MUST come before bare 'pepper', 'onion', 'tomato' etc. (more specific → first).
    'bell pepper':     0.39,  // chopped: 1 cup ≈ 92g
    'green pepper':    0.39,
    'red pepper':      0.39,
    'yellow pepper':   0.39,
    'orange pepper':   0.39,
    'jalapeno':        0.39,
    'poblano':         0.39,
    'pepper':          0.39,  // generic "pepper" when used as vegetable (chopped/sliced)
    'onion':           0.68,  // chopped: 1 cup ≈ 160g
    'shallot':         0.60,
    'leek':            0.55,  // sliced: 1 cup ≈ 130g
    'carrot':          0.52,  // sliced: 1 cup ≈ 122g
    'celery':          0.43,  // sliced: 1 cup ≈ 101g
    'tomato':          0.76,  // diced: 1 cup ≈ 180g
    'cucumber':        0.50,  // sliced: 1 cup ≈ 119g
    'zucchini':        0.48,  // sliced: 1 cup ≈ 113g
    'courgette':       0.48,
    'broccoli':        0.38,  // florets: 1 cup ≈ 91g
    'cauliflower':     0.38,  // florets: 1 cup ≈ 91g
    'mushroom':        0.30,  // sliced: 1 cup ≈ 70g
    'asparagus':       0.57,  // chopped: 1 cup ≈ 134g
    'peas':            0.73,  // shelled: 1 cup ≈ 145g
    'corn':            0.63,  // kernels: 1 cup ≈ 149g
    'beet':            0.68,  // diced: 1 cup ≈ 136g
    'eggplant':        0.40,  // cubed: 1 cup ≈ 99g
    'aubergine':       0.40,
    'pumpkin':         0.47,  // cubed: 1 cup ≈ 116g
    'squash':          0.47,
    // ─── Fresh herbs ─────────────────────────────────────────────────────────
    'parsley':         0.12,
    'cilantro':        0.12,
    'basil':           0.12,
    'dill':            0.12,
    'mint':            0.12,
    'chive':           0.10,
    'herb':            0.12,
};

// Runs tasks with at most `limit` in-flight at once, preserving result order.
async function withConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let next = 0;

    async function worker() {
        while (next < tasks.length) {
            const i = next++;
            results[i] = await tasks[i]();
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
    return results;
}

export class NutritionEngine {

    static getDensity(ingredientName: string): number {
        const lowerName = ingredientName.toLowerCase();
        for (const [key, density] of Object.entries(DENSITY_TABLE)) {
            if (lowerName.includes(key)) {
                return density;
            }
        }
        return 1.0; // Default to water density
    }

    static unitToGrams(unit: string, qty: number, ingredientName: string, cookingState?: CookingState): number {
        // Culinary convention: 'T' = tablespoon, 't' = teaspoon.
        // These must be checked before lowercasing or the distinction is lost.
        if (unit === 'T') return qty * 14.79;
        if (unit === 't') return qty * 4.93;

        const u = unit ? unit.toLowerCase().replace(/s$/, '') : ''; // singularize

        // 1. Convert Unit to ML (Volume) or Grams (Weight) directly
        let volumeMl = 0;
        let weightG = 0;

        // Weight (Direct)
        if (['g', 'gram'].includes(u)) weightG = qty;
        else if (['kg', 'kilogram'].includes(u)) weightG = qty * 1000;
        else if (['oz', 'ounce'].includes(u)) weightG = qty * 28.35;
        else if (['lb', 'pound'].includes(u)) weightG = qty * 453.59;

        // Volume -> Need Density
        else if (['ml', 'milliliter'].includes(u)) volumeMl = qty;
        else if (['l', 'liter'].includes(u)) volumeMl = qty * 1000;
        else if (['cup', 'c'].includes(u)) volumeMl = qty * 236.59;
        else if (['tbsp', 'tablespoon', 'tbs', 'tb'].includes(u)) volumeMl = qty * 14.79; // 'T' handled above; 'tbs' singularizes to 'tb'
        else if (['tsp', 'teaspoon', 'tspn'].includes(u)) volumeMl = qty * 4.93; // 't' handled above
        else if (['fl oz', 'floz'].includes(u)) volumeMl = qty * 29.57;
        else if (['pint', 'pt'].includes(u)) volumeMl = qty * 473.18;
        else if (['quart', 'qt'].includes(u)) volumeMl = qty * 946.35;
        else if (['gallon', 'gal'].includes(u)) volumeMl = qty * 3785.41;

        // Pastry sheet units — when parse-ingredient parses "8 phyllo sheets" as unit="phyllo"
        // or when the description contains "pastry sheets", apply per-sheet weight.
        else if (['phyllo', 'filo'].includes(u)) weightG = qty * 10; // 1 phyllo sheet ≈ 10g
        else if (['puff'].includes(u)) weightG = qty * 250; // 1 sheet puff pastry ≈ 250g from a 14oz block

        // Abstract / Count — named culinary units with known gram weights
        else if (['pinch', 'pn'].includes(u)) weightG = qty * 0.3;
        else if (['dash'].includes(u)) weightG = qty * 0.6;
        else if (['clove'].includes(u)) weightG = qty * 5;    // garlic clove ≈ 5g
        else if (['slice'].includes(u)) {
            const ln = ingredientName.toLowerCase();
            if      (ln.includes('bread') || ln.includes('toast')) weightG = qty * 30;
            else if (ln.includes('cheese'))                         weightG = qty * 20;
            else if (ln.includes('bacon') || ln.includes('prosciutto')) weightG = qty * 15;
            else if (ln.includes('tomato') || ln.includes('onion'))     weightG = qty * 20;
            else if (ln.includes('lemon') || ln.includes('lime'))       weightG = qty * 15;
            else                                                    weightG = qty * 25;
        }
        // ── Head/whole vegetable units ─────────────────────────────────────────────
        else if (['head'].includes(u)) {
            const ln = ingredientName.toLowerCase();
            // Baby/mini varieties must come BEFORE their full-size counterparts
            if      (ln.includes('baby') && (ln.includes('bok choy') || ln.includes('bok choi'))) weightG = qty * 100;
            else if (ln.includes('baby') && ln.includes('cabbage'))     weightG = qty * 300;
            else if (ln.includes('cauliflower'))                        weightG = qty * 600;
            else if (ln.includes('broccoli'))                           weightG = qty * 350;
            else if (ln.includes('cabbage'))                            weightG = qty * 900;
            else if (ln.includes('bok choy') || ln.includes('bok choi')) weightG = qty * 400;
            else if (ln.includes('romaine') || ln.includes('lettuce'))  weightG = qty * 500;
            else if (ln.includes('garlic'))                             weightG = qty * 40;
            else if (ln.includes('celery'))                             weightG = qty * 454;
            else if (ln.includes('fennel'))                             weightG = qty * 250;
            else                                                        weightG = qty * 500;
        }
        // ── Bundle / bunch units ───────────────────────────────────────────────────
        else if (['bunch', 'bundle'].includes(u)) {
            const ln = ingredientName.toLowerCase();
            if      (ln.includes('spinach') || ln.includes('kale') || ln.includes('chard')) weightG = qty * 300;
            else if (ln.includes('asparagus'))                          weightG = qty * 500;
            else if (ln.includes('green onion') || ln.includes('scallion')) weightG = qty * 100;
            else if (ln.includes('parsley') || ln.includes('cilantro') || ln.includes('herb')) weightG = qty * 50;
            else                                                        weightG = qty * 100;
        }
        // ── Stalk / rib / spear units ──────────────────────────────────────────────
        else if (['stalk', 'rib', 'stick', 'spear', 'stem'].includes(u)) {
            const ln = ingredientName.toLowerCase();
            if      (ln.includes('celery'))                             weightG = qty * 40;
            else if (ln.includes('asparagus'))                          weightG = qty * 20;
            else if (ln.includes('lemongrass'))                         weightG = qty * 30;
            else if (ln.includes('cinnamon'))                           weightG = qty * 3;
            else                                                        weightG = qty * 30;
        }
        // ── Small block / cube units ───────────────────────────────────────────────
        else if (['cube', 'block', 'square'].includes(u)) {
            const ln = ingredientName.toLowerCase();
            if      (ln.includes('bouillon') || ln.includes('stock') || ln.includes('broth')) weightG = qty * 5;
            else if (ln.includes('chocolate'))                          weightG = qty * 30;
            else if (ln.includes('tofu'))                               weightG = qty * 70;
            else                                                        weightG = qty * 15; // fermented bean curd cubes ≈ 15g each
        }
        // ── Sheet / layer units ───────────────────────────────────────────────────
        else if (['sheet', 'layer', 'leaf', 'leave'].includes(u)) {
            const ln = ingredientName.toLowerCase();
            if (ln.includes('nori') || ln.includes('seaweed'))         weightG = qty * 3;
            else if (ln.includes('lasagna') || ln.includes('pasta'))   weightG = qty * 25;
            else if (ln.includes('phyllo') || ln.includes('filo'))     weightG = qty * 10;
            else if (ln.includes('bay'))                                weightG = qty * 0.5;
            else                                                        weightG = qty * 5;
        }
        // ── Can / tin units ───────────────────────────────────────────────────────
        else if (['can', 'tin'].includes(u)) {
            const ln = ingredientName.toLowerCase();
            if      (ln.includes('coconut milk'))                       weightG = qty * 400;
            else if (ln.includes('tomato'))                             weightG = qty * 400;
            else if (ln.includes('beans') || ln.includes('chickpea') || ln.includes('lentil')) weightG = qty * 400;
            else if (ln.includes('tuna') || ln.includes('salmon') || ln.includes('sardine')) weightG = qty * 140;
            else                                                        weightG = qty * 400;
        }
        else {
            // No unit (e.g. "2 apples") or unknown unit — count-based assumptions
            const lowerName = ingredientName.toLowerCase();

            const spiceKeywords = ['salt', 'pepper', 'cinnamon', 'paprika', 'cumin', 'turmeric',
                                   'oregano', 'thyme', 'rosemary', 'basil', 'parsley', 'cilantro',
                                   'dill', 'chive', 'sage', 'bay leaf', 'vanilla', 'extract',
                                   'powder', 'seasoning', 'spice', 'clove', 'nutmeg', 'ginger',
                                   // Additional spices/hot peppers commonly listed without quantity
                                   'cayenne', 'saffron', 'cardamom', 'fennel seed', 'fenugreek',
                                   'za\'atar', 'sumac', 'harissa', 'mace', 'aleppo',
                                   // Tiny count-based ingredients treated as spice-level amounts
                                   'coffee bean', 'vanilla bean', 'star anise', 'bay leave'];
            if (spiceKeywords.some(k => lowerName.includes(k))) return qty * 2;

            let unitWeight = 100; // Default — more specific checks must come first
            // ── Eggs ────────────────────────────────────────────────────────────
            if      (lowerName.includes('egg yolk'))  unitWeight = 17;  // 1 yolk ≈ 17g
            else if (lowerName.includes('egg white')) unitWeight = 33;  // 1 white ≈ 33g
            else if (lowerName.includes('egg'))       unitWeight = 50;  // whole egg ≈ 50g
            // ── Fruits ──────────────────────────────────────────────────────────
            else if (lowerName.includes('banana'))    unitWeight = 120;
            else if (lowerName.includes('apple'))     unitWeight = 182;
            else if (lowerName.includes('avocado'))   unitWeight = 150;
            else if (lowerName.includes('lemon'))     unitWeight = 60;
            else if (lowerName.includes('lime'))      unitWeight = 45;
            else if (lowerName.includes('orange'))    unitWeight = 130;
            else if (lowerName.includes('grapefruit'))unitWeight = 230;
            else if (lowerName.includes('pear'))      unitWeight = 180;
            else if (lowerName.includes('peach'))     unitWeight = 150;
            else if (lowerName.includes('mango'))     unitWeight = 200;
            else if (lowerName.includes('plum'))      unitWeight = 65;
            else if (lowerName.includes('apricot'))   unitWeight = 35;
            else if (lowerName.includes('fig'))       unitWeight = 40;
            else if (lowerName.includes('date'))      unitWeight = 7;   // medjool date ≈ 24g; deglet ≈ 7g
            else if (lowerName.includes('strawberr'))  unitWeight = 12;  // strawberry / strawberries (plural 'y→ies' breaks .includes('strawberry'))
            else if (lowerName.includes('cherr'))     unitWeight = 8;   // cherry / cherries (plural 'y→ies' breaks .includes('cherry'))
            else if (lowerName.includes('blueberr'))  unitWeight = 2;   // blueberry ≈ 2g each
            else if (lowerName.includes('raspberr'))  unitWeight = 4;
            else if (lowerName.includes('blackberr')) unitWeight = 5;
            else if (lowerName.includes('marshmallow')) unitWeight = 7; // large marshmallow ≈ 7g; mini ≈ 1g
            // ── Vegetables ──────────────────────────────────────────────────────
            else if (lowerName.includes('romaine'))   unitWeight = 500; // 1 head romaine ≈ 500g
            else if (lowerName.includes('lettuce'))   unitWeight = 400; // 1 head generic lettuce
            else if (lowerName.includes('cabbage'))   unitWeight = 900;
            else if (lowerName.includes('onion'))     unitWeight = 110;
            else if (lowerName.includes('carrot'))    unitWeight = 60;
            // ── Starchy roots & tubers ──────────────────────────────────────────
            else if (lowerName.includes('sweet potato') || lowerName.includes('yam')) unitWeight = 130;
            else if (lowerName.includes('potato'))    unitWeight = 213;
            // ── Large whole squash / gourds ─────────────────────────────────────
            // These are often listed as "1 kabocha squash" with no unit — default 100g is
            // wildly wrong (a kabocha squash is ~1.3 kg).
            else if (lowerName.includes('kabocha'))       unitWeight = 1361; // ~3 lbs
            else if (lowerName.includes('butternut'))     unitWeight = 1000;
            else if (lowerName.includes('acorn squash'))  unitWeight = 680;
            else if (lowerName.includes('delicata'))      unitWeight = 340;
            else if (lowerName.includes('honeynut') || lowerName.includes('honey nut')) unitWeight = 680;
            else if (lowerName.includes('squash') && !lowerName.includes('summer') && !lowerName.includes('zucchini')) unitWeight = 900;
            // ── Large radishes / daikon ──────────────────────────────────────────
            else if (lowerName.includes('daikon'))    unitWeight = 450; // 1 large daikon ≈ 400-500g (not 9g like a garden radish)
            // ── Dried whole chiles ───────────────────────────────────────────────
            // Dried chiles are tiny: árbol ≈ 2g, guajillo ≈ 6g, ancho ≈ 20g.
            // Fresh chiles are ~15-30g each. "dried" is in PREP_WORDS so check the raw name.
            else if (lowerName.includes('chile') || lowerName.includes('chili') || lowerName.includes('chilli')) {
                const isDried = lowerName.includes('dried') || lowerName.includes('árbol') || lowerName.includes('arbol')
                                || lowerName.includes('guajillo') || lowerName.includes('ancho') || lowerName.includes('mulato')
                                || lowerName.includes('pasilla') || lowerName.includes('chipotle');
                unitWeight = isDried ? 3 : 15; // dried ~3g each; fresh ~15g each
            }
            else if (lowerName.includes('zucchini') || lowerName.includes('courgette')) unitWeight = 200;
            else if (lowerName.includes('eggplant') || lowerName.includes('aubergine')) unitWeight = 420;
            else if (lowerName.includes('bell pepper') || lowerName.includes('red pepper') || lowerName.includes('green pepper'))
                                                      unitWeight = 150;
            else if (lowerName.includes('pepper') && !spiceKeywords.some(k => lowerName.includes(k))) unitWeight = 150;
            else if (lowerName.includes('tomato'))    unitWeight = 120;
            else if (lowerName.includes('beet'))      unitWeight = 82;
            else if (lowerName.includes('turnip'))    unitWeight = 120;
            else if (lowerName.includes('parsnip'))   unitWeight = 100;
            else if (lowerName.includes('cucumber'))  unitWeight = 300;
            else if (lowerName.includes('corn'))      unitWeight = 90;  // 1 ear shucked
            else if (lowerName.includes('artichoke')) unitWeight = 120;
            else if (lowerName.includes('mushroom'))  unitWeight = 20;  // 1 button mushroom ≈ 18-20g
            // ── Proteins ────────────────────────────────────────────────────────
            else if (lowerName.includes('chicken') && (lowerName.includes('breast') || lowerName.includes('thigh'))) unitWeight = 200;
            else if (lowerName.includes('shrimp') || lowerName.includes('prawn')) unitWeight = 12; // 1 large shrimp ≈ 12g
            else if (lowerName.includes('scallop'))   unitWeight = 25;
            else if (lowerName.includes('oyster'))    unitWeight = 20;
            else if (lowerName.includes('clam'))      unitWeight = 15;
            else if (lowerName.includes('mussel'))    unitWeight = 18;
            else if (lowerName.includes('meatball'))  unitWeight = 30;  // standard meatball ≈ 30g
            // ── Bread & baked goods ─────────────────────────────────────────────
            else if (lowerName.includes('pita'))       unitWeight = 70;  // 1 pita bread ≈ 60-80g
            else if (lowerName.includes('tortilla'))   unitWeight = 45;  // 1 flour tortilla ≈ 45g
            else if (lowerName.includes('naan'))       unitWeight = 90;  // 1 naan ≈ 90g
            else if (lowerName.includes('slice') || lowerName.includes('bread')) unitWeight = 30;
            // ── Small packaged/bite-size items ────────────────────────────────
            // Critical: these are often given as counts ("50 Oreo cookies", "20 crackers")
            // and would otherwise default to 100g each — 10-20x too heavy.
            else if (lowerName.includes('oreo'))      unitWeight = 11;  // 1 Oreo ≈ 11.3g
            else if (lowerName.includes('cookie') || lowerName.includes('biscuit')) unitWeight = 15;
            else if (lowerName.includes('wafer'))     unitWeight = 7;   // vanilla wafer ≈ 7g
            else if (lowerName.includes('cracker'))   unitWeight = 7;   // 1 cracker ≈ 4-10g
            else if (lowerName.includes('pretzel') && (lowerName.includes('mini') || lowerName.includes('small')))
                                                      unitWeight = 3;
            else if (lowerName.includes('pretzel'))   unitWeight = 15;  // medium soft pretzel ≈ 60g; hard ≈ 15g
            else if (lowerName.includes('potato chip') || lowerName.includes('chip')) unitWeight = 2;
            else if (lowerName.includes('tortilla chip')) unitWeight = 6;
            else if (lowerName.includes('gummy') || lowerName.includes('candy')) unitWeight = 4;
            // ── Cube/block descriptor in the name (parse-ingredient may put 'cubes' ──
            // in the description rather than the unit field, so handle it here too.
            else if (lowerName.includes('cube') || lowerName.includes('block')) {
                if      (lowerName.includes('bouillon') || lowerName.includes('stock') || lowerName.includes('broth')) unitWeight = 5;
                else if (lowerName.includes('chocolate'))  unitWeight = 30;
                else if (lowerName.includes('tofu'))       unitWeight = 70;
                else                                       unitWeight = 15; // fermented bean curd, etc.
            }
            // ── Pastry sheets (description-based detection) ─────────────────────
            else if (lowerName.includes('phyllo') || lowerName.includes('filo')) unitWeight = 10;
            else if (lowerName.includes('puff pastry') || lowerName.includes('pastry sheet')) unitWeight = 250;

            return qty * unitWeight;
        }

        if (weightG > 0) return weightG;

        if (volumeMl > 0) {
            const density = cookingState === 'cooked'
                ? (getCookedDensity(ingredientName) ?? this.getDensity(ingredientName))
                : this.getDensity(ingredientName);
            return volumeMl * density;
        }

        return 100 * qty;
    }

    static parseQuantity(qtyStr: string): number {
        if (!qtyStr) return 1;
        try {
            const parts = qtyStr.trim().split(' ');
            let total = 0;
            for (const part of parts) {
                if (part.includes('/')) {
                    const [num, den] = part.split('/').map(Number);
                    if (den !== 0) total += num / den;
                } else {
                    total += parseFloat(part) || 0;
                }
            }
            return total || 1;
        } catch (e) { return 1; }
    }

    /**
     * Resolve weight for an ingredient that has a count/size-based unit (or no unit)
     * using the USDA portion table returned with the food detail.
     *
     * Priority:
     *  1. Explicit size qualifier match (medium, large, small, whole, piece, stalk, head…)
     *  2. Any "medium" or "whole" portion as a general default for count items
     *
     * Returns null if no usable portion is found — caller falls back to unitToGrams.
     */
    private static resolveWeightFromPortions(
        portions: { measure: string; gramWeight: number }[],
        unit: string,
        qty: number,
    ): number | null {
        if (!portions || portions.length === 0) return null;

        const u = unit ? unit.toLowerCase().replace(/s$/, '') : '';

        // Volume and weight units are handled by unitToGrams — don't override them here
        const METRIC_UNITS = ['g','gram','kg','kilogram','oz','ounce','lb','pound',
                              'ml','milliliter','l','liter','cup','tbsp','tablespoon',
                              'tbs','tb','tsp','teaspoon','fl','pint','pt','quart',
                              'qt','gallon','gal'];
        if (METRIC_UNITS.includes(u)) return null;

        // Size qualifiers to match against USDA portion descriptions
        const SIZE_KEYWORDS: [string, string[]][] = [
            [u,        [u]],                           // exact match on the unit string
            ['large',  ['large', 'xl', 'extra large']],
            ['medium', ['medium', 'med']],
            ['small',  ['small', 'sm']],
            ['whole',  ['whole', 'item', 'piece', 'each']],
            ['stalk',  ['stalk', 'stem', 'spear']],
            ['head',   ['head']],
            ['bunch',  ['bunch', 'bundle']],
            ['slice',  ['slice', 'piece']],
            ['leaf',   ['leaf', 'leave']],
            ['sprig',  ['sprig']],
            ['clove',  ['clove']],
            ['ear',    ['ear']],
        ];

        for (const [key, synonyms] of SIZE_KEYWORDS) {
            if (!key || key.length < 2) continue;
            const matched = portions.find(p =>
                synonyms.some(s => p.measure.toLowerCase().includes(s))
            );
            if (matched) return matched.gramWeight * qty;
        }

        // Fall through: no size qualifier — for a plain count ("2 apples") use medium.
        // Sort by gramWeight ascending so we prefer individual-item portions over
        // container/package-level portions (e.g., "1 cookie" at 11g beats "1 package" at 487g).
        const matchingPortions = portions
            .filter(p => {
                const pm = p.measure.toLowerCase();
                return pm.includes('medium') || pm.includes('whole') || pm.includes('piece') ||
                       pm.includes('item') || pm.includes('each');
            })
            .sort((a, b) => a.gramWeight - b.gramWeight);

        // Reject implausibly large "per item" weights when we have a high item count.
        // If qty > 3 and every matching portion is >150g, it's almost certainly a
        // container measure, not a single-item measure — fall back to unitToGrams.
        const MAX_PER_ITEM_G = qty > 3 ? 150 : 2000;
        const best = matchingPortions.find(p => p.gramWeight <= MAX_PER_ITEM_G);
        if (best) return best.gramWeight * qty;

        return null;
    }

    // Looks up nutrition for a single ingredient line with a multi-strategy search.
    private static async lookupIngredient(
        line: string,
        dishContext: DishContext = 'standard',
    ): Promise<{ breakdown: any; stats: NutritionTotal | null }> {
        // Normalise unicode fractions so the parser handles them
        let processedLine = line
            .replace(/½/g, ' 1/2 ').replace(/⅓/g, ' 1/3 ').replace(/⅔/g, ' 2/3 ')
            .replace(/¼/g, ' 1/4 ').replace(/¾/g, ' 3/4 ')
            .replace(/⅕/g, ' 1/5 ').replace(/⅖/g, ' 2/5 ').replace(/⅗/g, ' 3/5 ').replace(/⅘/g, ' 4/5 ')
            .replace(/⅙/g, ' 1/6 ').replace(/⅚/g, ' 5/6 ')
            .replace(/⅛/g, ' 1/8 ').replace(/⅜/g, ' 3/8 ').replace(/⅝/g, ' 5/8 ').replace(/⅞/g, ' 7/8 ');

        // ── Pre-parse normalizations ──────────────────────────────────────────────
        //
        // 1a. Range quantities — "X to Y": "8 to 8 1/2 cups flour" → "8 cups flour"
        //    Recipe writers often use "X to Y" to indicate flexibility. parse-ingredient
        //    only extracts the first number but leaves "to Y" as garbage in the description,
        //    which confuses unit detection and produces count-based 100g-per-item weights.
        processedLine = processedLine.replace(
            /^(\d+(?:\s+\d+\/\d+|\.\d+)?)\s+to\s+(?:\d+(?:\s+\d+\/\d+|\.\d+)?\s+)/i,
            '$1 '
        );

        // 1b. Range quantities — "X-Y" (hyphen as range separator):
        //    "4-6 heads baby bok choy" → "4 heads baby bok choy"
        //    "2-3 tablespoons oil"     → "2 tablespoons oil"
        //    Only normalise when the hyphen is between two integers at the start of the line.
        processedLine = processedLine.replace(
            /^(\d+)-(\d+)(\s)/,
            '$1$3'
        );

        // 2. Trailing unit descriptors: "olive oil, dash" / "oil, a drizzle"
        //    When a size/quantity word follows a comma at the END of the ingredient line
        //    (not at the start where parse-ingredient would recognise it as a unit),
        //    we move it to the front so parse-ingredient handles it correctly.
        processedLine = processedLine.replace(
            /^(.+?),\s*(a\s+)?(dash|drizzle|drop|pinch|splash)\s*$/i,
            '$3 of $1'
        );

        // 1. Parse
        let parsed: any = null;
        try {
            const results = parseIngredient(processedLine);
            const first = Array.isArray(results) ? results[0] : results;
            if (first && first.description) parsed = first;
        } catch (_) { /* fall through */ }

        if (!parsed) {
            const regex = /^((?:\d+\s+)?\d+\/\d+|\d+(?:\.\d+)?|\d+)\s*([a-zA-Z]+)?\s+(.*)$/;
            const match = processedLine.match(regex);
            parsed = match
                ? { quantity: this.parseQuantity(match[1]), unitOfMeasure: match[2] || null, description: match[3] }
                : { description: processedLine, quantity: 1, unitOfMeasure: null };
        }

        const name: string  = parsed.description || processedLine;
        const qty:  number  = parsed.quantity ?? 1;
        const unit: string  = parsed.unitOfMeasure || '';

        // 1b. Non-consumed / negligible-calorie ingredient early exit
        //
        // "For frying" oil: only 8-15% is absorbed by food; counting the full
        // volume inflates pho/deep-fry recipes by 10-20×.
        // "For stock" bones / whole poultry: used as cooking media then discarded —
        // calorie content does not transfer to the finished dish.
        // "Water" in broth / poaching liquid: genuinely zero calories; a bad OFW
        // cache entry at 100 kcal/100g cannot be caught by the >900 eviction alone.
        const FRY_OIL_PATTERN = /\bfor\s+(deep[- ]?fry|shallow[- ]?fry|pan[- ]?fry|frying|deep\s+frying)\b|\bfrying\s+oil\b/i;
        const STOCK_PATTERN   = /\bfor\s+(stock|broth|the\s+broth|the\s+stock)\b|\bmake\s+(the\s+)?(stock|broth)\b/i;
        const WATER_TERMS = new Set(['water', 'ice water', 'cold water', 'warm water', 'hot water',
                                      'boiling water', 'ice', 'sparkling water', 'mineral water',
                                      'soda water', 'carbonated water', 'filtered water']);

        // 2. Detect cooking state from the original line and the cleaned ingredient name
        const searchTerms = getSearchTerms(name);
        const primaryTerm = searchTerms[0] ?? name;
        const detectedState = detectCookingState(line, primaryTerm);

        // Resolve ambiguous grains/legumes using the dish context.
        // Each dish type has a defined rule (see cookingState.ts DISH_GRAIN_STATE).
        const cookingState: CookingState = resolveCookingState(detectedState, dishContext);

        const preferCooked = cookingState === 'cooked';

        // Cache key includes cooking state so cooked and raw variants are stored separately
        const cacheKey = `v11:${primaryTerm.toLowerCase()}${preferCooked ? ':cooked' : ''}`;

        // Zero-calorie override for water-type ingredients.
        // USDA data for water is 0 kcal/100g but OFW sometimes caches bad matches.
        // Rather than fighting cache entries, short-circuit to 0 for known zero-cal terms.
        if (WATER_TERMS.has(primaryTerm.toLowerCase())) {
            const wg = this.unitToGrams(unit, qty, name, cookingState);
            const ZERO_STATS = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0, calcium_mg: 0, iron_mg: 0, vitamin_a_mcg: 0, vitamin_c_mg: 0 };
            return {
                breakdown: { ingredient: line, parsed: { name, searchTerm: primaryTerm, weightGrams: wg, unit, qty }, cookingState, stats: ZERO_STATS, source: 'override:zero-cal' },
                stats: ZERO_STATS,
            };
        }

        // 3. Baseline lookup — hardcoded USDA values for ~120 common ingredients.
        //    Consulted FIRST, before the cache and any external API, so these results
        //    are immune to USDA rate limits, OFW mismatches, and cache poisoning.
        //    All downstream if(!nutritionInfo) guards naturally skip when this hits.
        let nutritionInfo: UsdaNutrition | SimpleNutrition | null = lookupBaseline(primaryTerm);
        let source    = nutritionInfo ? 'baseline' : 'usda';
        let usedTerm  = primaryTerm;

        // 4. Cache lookup — fully skipped when baseline already matched.
        const { data: cached } = nutritionInfo ? { data: null } : await supabase
            .from('ingredient_cache')
            .select('*')
            .eq('term', cacheKey)
            .single();

        if (cached && !nutritionInfo) {
            const n = cached.nutrition as any;
            const serv = n?.serving_size_g || 100;
            const calPer100g = ((n?.calories ?? 0) / serv) * 100;

            // Ingredient-type-specific maximum calorie densities.
            // Pure fat caps at ~884 kcal/100g — anything above that is physically impossible.
            // For specific low-calorie ingredient types, apply tighter limits to catch
            // bad OFW matches at moderate densities (e.g., "water" cached at 100 kcal/100g,
            // "cauliflower" cached as cauliflower gratin at 75 kcal/100g).
            const keyRaw   = cacheKey.replace(/^v11:/, '');              // e.g. "spaghetti" or "spaghetti:cooked"
            const keyLower = keyRaw.replace(/:cooked$/, '');              // e.g. "spaghetti"
            const isCookedKey = keyRaw.endsWith(':cooked');               // true when calorie data should be for cooked
            // NOTE: No trailing \b on ingredient roots — "onion" must also match "onions",
            // "tomato" must match "tomatoes", "cherr" must match "cherries", etc.
            const maxCal =
                // Near-zero-calorie ingredients: salt is NaCl = 0 kcal; water ~0
                /^water$|^(chicken|beef|vegetable)\s+broth$|^(chicken|beef|vegetable)\s+stock$|^broth$|^stock$/.test(keyLower) ? 15 :
                /\bsalt\b|\bsodium chloride\b|\bkosher salt\b|\bsea salt\b/.test(keyLower) ? 5  :
                /broth|stock/.test(keyLower)                         ? 30  :
                // Fruit juices: fresh lemon/lime juice ~22 kcal/100ml, grape ~60; concentrated higher
                /lemon.?juice|lime.?juice|citrus.?juice/.test(keyLower) ? 40 :
                /orange.?juice|apple.?juice|fruit.?juice|\bjuice\b/.test(keyLower) ? 100 :
                // Spirits (~220-280 kcal/100g at 40% ABV); liqueurs higher but still ≤400
                /whiskey|whisky|bourbon|vodka|\brum\b|\bgin\b|tequila|brandy|cognac|schnapps/.test(keyLower) ? 300 :
                /liqueur|amaretto|kahlua|baileys|triple.?sec|cointreau/.test(keyLower) ? 400 :
                // Cruciferous / brassica (raw ≤40 kcal/100g; cooked with oil ≤60)
                /brassica|crucifer|romanesco/.test(keyLower) ? 60 :
                // Low-calorie non-starchy vegetables
                /cauliflower|broccoli|zucchini|courgette|cucumber|celery|radish|asparagus|artichoke/.test(keyLower) ? 60 :
                /cabbage|lettuce|spinach|kale|bok.?choy|chard/.test(keyLower) ? 60 :
                // Moderate-calorie veg (starchy or slightly denser; raw ≤80 kcal/100g)
                /squash|pumpkin|eggplant|aubergine|turnip|parsnip|beet/.test(keyLower) ? 80 :
                /\bpotato\b|\byam\b|\btaro\b|\byuca\b|\bcassava\b/.test(keyLower)      ? 130 :  // raw potato ~77; mashed ~113
                /tomato|pepper|onion|carrot|green.?bean|mushroom|corn/.test(keyLower)  ? 80 :
                // Dairy — condensed/evaporated are legitimately high; whole milk ~61
                /\bmilk/.test(keyLower)                              ? 80  :
                900; // hard physical limit for everything else

            // Minimum calorie density for inherently high-calorie ingredient types.
            // Evict entries that are suspiciously TOO LOW — a sign that USDA returned
            // a wrong food. Two common failure modes:
            //   "spaghetti" → "spaghetti squash, raw" at 31 kcal/100g (wrong food entirely)
            //   "spaghetti" (raw key) → Survey FNDDS "Spaghetti" at cooked density ~170 kcal/100g
            //     (right food but cooked values stored in the raw-key slot)
            const IS_PASTA = /pasta|spaghetti|noodle|fettuccine|penne|rigatoni|linguine|fusilli|farfalle|orzo|macaroni|lasagna/.test(keyLower);
            const minCal =
                IS_PASTA && !isCookedKey ? 280 :  // dry pasta: ~350-380 kcal/100g; cooked FNDDS ~170 → evict
                IS_PASTA &&  isCookedKey ? 100 :  // cooked pasta: ~130-175 kcal/100g is fine
                /\bbread\b|\bbagel\b|\bcroissant\b|\broll\b|\bbun\b/.test(keyLower) ? 150 :
                /\bchees/.test(keyLower) ? 100 :
                0; // no minimum for everything else

            if (calPer100g < minCal || calPer100g > maxCal) {
                // Evict the bad entry so the next pass re-queries correctly.
                supabase.from('ingredient_cache').delete().eq('term', cacheKey).then();
            } else {
                nutritionInfo = n;
                source        = cached.source;
            }
        }

        if (!nutritionInfo) {
            // Detect packaged/branded foods — check the FULL original line, not just
            // the parsed description. parse-ingredient extracts 'chickpeas' from
            // '1 can chickpeas', so checking name alone would miss the 'can' signal.
            const isPackaged = looksLikePackagedFood(line);

            // ── Source 1: USDA (primary for raw ingredients) ───────────────────
            if (!isPackaged) {
                for (const term of searchTerms) {
                    const usdaData = await searchUsda(term, preferCooked);
                    if (usdaData) {
                        nutritionInfo = usdaData; source = 'usda'; usedTerm = term;
                        supabase.from('ingredient_cache')
                            .upsert({ term: cacheKey, nutrition: usdaData as any, source: 'usda' })
                            .then();
                        break;
                    }
                }
            }

            // ── Source 2: Open Food Facts (packaged goods + USDA fallback) ─────
            if (!nutritionInfo) {
                for (const term of searchTerms) {
                    const offData = await searchOpenFoodFacts(term);
                    if (offData) {
                        // Plausibility gate: for non-packaged raw ingredients, reject OFW
                        // results that exceed the expected calorie density for the ingredient
                        // category. OFW often returns processed products (e.g., "Cauliflower
                        // Gratin" at 75 kcal/100g for raw cauliflower at 25 kcal/100g).
                        let offPlausible = true;
                        if (!isPackaged) {
                            const offCal = (offData.calories ?? 0) / (offData.serving_size_g || 100) * 100;
                            const tl = term.toLowerCase();
                            // Reject OFW results with implausibly high calorie densities for known
                            // low-calorie ingredient categories. Thresholds are generous (2-3×
                            // the raw value) so that legitimately richer preparations still pass.
                            if (/brassica|crucifer|romanesco/.test(tl) && offCal > 60)          offPlausible = false;
                            if (/cauliflower|broccoli|zucchini|cucumber|celery|radish|asparagus|artichoke|cabbage|lettuce|spinach|kale|chard/.test(tl) && offCal > 60) offPlausible = false;
                            if (/squash|pumpkin|eggplant|tomato|onion|carrot|beet|turnip|parsnip/.test(tl) && offCal > 80) offPlausible = false;
                            if (/\bpotato\b/.test(tl) && offCal > 130) offPlausible = false;
                            if (/\bchile\b|\bchili\b|\bjalapeno\b|\bbird.?s.?eye\b|\bhabanero\b/.test(tl) && offCal > 80) offPlausible = false;
                            if (/zest/.test(tl) && offCal > 200) offPlausible = false;
                            if (/\bsalt\b/.test(tl)   && offCal > 5)   offPlausible = false;
                            if (/lemon.?juice|lime.?juice/.test(tl) && offCal > 40) offPlausible = false;
                            if (/\bjuice\b/.test(tl)  && offCal > 120) offPlausible = false;
                            if (/whiskey|whisky|bourbon|vodka|\brum\b|\bgin\b|tequila|brandy/.test(tl) && offCal > 300) offPlausible = false;
                            if (/\bmilk\b/.test(tl)   && offCal > 80)  offPlausible = false;
                        }
                        if (offPlausible) {
                            nutritionInfo = offData as any; source = 'openfoodfacts'; usedTerm = term;
                            supabase.from('ingredient_cache')
                                .upsert({ term: cacheKey, nutrition: offData as any, source: 'openfoodfacts' })
                                .then();
                            break;
                        }
                    }
                }
            }

            // ── Source 3: USDA second pass (for packaged items USDA does carry) ─
            if (!nutritionInfo && isPackaged) {
                for (const term of searchTerms) {
                    const usdaData = await searchUsda(term, preferCooked);
                    if (usdaData) {
                        nutritionInfo = usdaData; source = 'usda'; usedTerm = term;
                        supabase.from('ingredient_cache')
                            .upsert({ term: cacheKey, nutrition: usdaData as any, source: 'usda' })
                            .then();
                        break;
                    }
                }
            }

            // ── Source 4: FatSecret (production only — IP whitelisted) ──────────
            if (!nutritionInfo) {
                for (const term of searchTerms) {
                    const fsData = await searchFatSecret(term);
                    if (fsData) {
                        nutritionInfo = fsData; source = 'fatsecret'; usedTerm = term;
                        supabase.from('ingredient_cache')
                            .upsert({ term: cacheKey, nutrition: fsData as any, source: 'fatsecret' })
                            .then();
                        break;
                    }
                }
            }
        }

        if (!nutritionInfo) {
            return {
                breakdown: {
                    ingredient: line,
                    status: 'not_found',
                    tried: searchTerms,
                    cookingState,
                },
                stats: null,
            };
        }

        // 6. Weight calculation
        //    Priority: explicit metric unit → USDA portion data → unitToGrams heuristic
        //    For cooked grains/legumes, unitToGrams uses cooked-density table for volumes.
        const portions = (nutritionInfo as any).portions as { measure: string; gramWeight: number }[] | undefined;

        const portionWeight  = this.resolveWeightFromPortions(portions ?? [], unit, qty);
        const heuristicWeight = this.unitToGrams(unit, qty, name, cookingState);

        // Choose between portion-derived and heuristic weights.
        // Normally portion data (from USDA detail endpoint) is more accurate.
        // Exception: for count-based small items (cookies, crackers, chips…),
        // USDA "1 medium serving" often means N items (e.g., 3 cookies = 45g),
        // which inflates the per-item weight. When the portion-derived per-item
        // weight is >3× our heuristic AND our heuristic says <50g per item,
        // trust the heuristic instead.
        const METRIC_UNIT_SET = new Set(['g','gram','kg','kilogram','oz','ounce','lb','pound',
                                         'ml','milliliter','l','liter','cup','tbsp','tablespoon',
                                         'tbs','tb','tsp','teaspoon','fl','pint','pt','quart','qt','gallon','gal']);
        const isCountBased = !METRIC_UNIT_SET.has(unit.toLowerCase().replace(/s$/, ''));

        // "baby" / "mini" qualifiers make items significantly smaller than the USDA head/portion.
        // Raise the per-item heuristic threshold when these modifiers are present so the
        // smart comparison can override USDA portion data for undersized produce.
        const hasBabyModifier = name.toLowerCase().includes('baby') || name.toLowerCase().includes('mini');
        const sizeThreshold   = hasBabyModifier ? 300 : 50;

        let weightGrams: number;
        if (portionWeight !== null) {
            const perItemPortion   = portionWeight   / Math.max(qty, 1);
            const perItemHeuristic = heuristicWeight / Math.max(qty, 1);

            // Over-sized portion: USDA "1 medium serving" is for N items, not 1.
            // e.g. "50 Oreo cookies" → portion=24,350g (package), heuristic=550g → use heuristic.
            const portionTooBig = isCountBased && perItemPortion > perItemHeuristic * 3 && perItemHeuristic < sizeThreshold;

            // Under-sized portion: USDA matched the wrong (much smaller) food.
            // e.g. "1 large daikon radish" → USDA portion=9g (tiny garden radish), heuristic=450g.
            // If portion is <10% of heuristic and heuristic is substantial, USDA found the wrong food.
            const portionTooSmall = isCountBased && portionWeight < heuristicWeight * 0.10 && heuristicWeight > 80;

            if (portionTooBig || portionTooSmall) {
                weightGrams = heuristicWeight;
            } else {
                weightGrams = portionWeight;
            }
        } else {
            weightGrams = heuristicWeight;
        }

        // 6a-extra: No-quantity pure fat → cooking-portion default
        // "olive oil" / "butter" with no numeric content gets 100g (884 kcal) by default.
        // When no digits appear anywhere in the ingredient line, treat it as an unmeasured
        // cooking medium and assign 1 tablespoon (~14g).
        if (!/\d/.test(line) && isCountBased && weightGrams >= 100) {
            const lln = name.toLowerCase();
            if (/\boil\b/.test(lln) || /\bbutter\b/.test(lln) || /\blard\b/.test(lln) || /\bghee\b/.test(lln)) {
                weightGrams = 14; // 1 tablespoon cooking fat
            }
        }

        // 6a. Trace / garnish override
        // Ingredients listed as "for garnish", "for greasing", "to taste" etc. have no
        // meaningful measured quantity. Cap their weight to a tiny culinary amount so they
        // don't inflate totals (e.g., "nonstick cooking spray" shouldn't add 897 kcal).
        const TRACE_PATTERN = /\b(for\s+garnish|as\s+garnish|for\s+decoration|for\s+topping|as\s+topping|for\s+greasing|to\s+grease|for\s+coating|to\s+coat|for\s+brushing|for\s+dusting|for\s+drizzling|for\s+sprinkling|as\s+needed|to\s+taste|cooking\s+spray|nonstick\s+spray|optional|if\s+desired)\b/i;
        // Note: qty defaults to 1, so we cannot use !qty as a "no quantity" signal.
        // Instead cap any trace/garnish ingredient that resolved to a large weight.
        if (TRACE_PATTERN.test(line) && weightGrams > 15) {
            weightGrams = 5; // 5g is a reasonable trace amount for a garnish or topping
        } else if (/\bcooking\s+spray\b/i.test(line) && weightGrams > 5) {
            weightGrams = 1; // cooking spray delivers ~0.3–1g per use
        } else if (/\bfor\s+garnish\b|\bas\s+garnish\b/i.test(line) && weightGrams > 10) {
            weightGrams = 2; // garnish items: 1–3g
        }

        // 6b. Frying oil — only 8-15% is absorbed by food; count 10% of measured volume.
        // "6 cups oil for deep frying" contributes ~1,000 kcal, not ~11,000 kcal.
        if (FRY_OIL_PATTERN.test(line)) {
            weightGrams = weightGrams * 0.10;
        }

        // 6c. Stock / broth-making ingredients — bones and whole poultry used to make
        // broth are discarded after cooking; their calories do not transfer to the broth.
        // Zero out weight (the broth itself is typically a separate ingredient line).
        if (STOCK_PATTERN.test(line)) {
            weightGrams = 0;
        }

        // 7. Compute contribution  (USDA nutrients are per 100 g)
        const baseWeight = nutritionInfo.serving_size_g || 100;
        const ratio      = weightGrams / baseWeight;
        const n          = nutritionInfo as any;

        const stats: NutritionTotal = {
            calories:      (n.calories      || 0) * ratio,
            protein:       (n.protein       || 0) * ratio,
            fat:           (n.fat           || 0) * ratio,
            carbs:         (n.carbs         || 0) * ratio,
            fiber:         (n.fiber         || 0) * ratio,
            sugar:         (n.sugar         || 0) * ratio,
            calcium_mg:    (n.calcium_mg    || 0) * ratio,
            iron_mg:       (n.iron_mg       || 0) * ratio,
            vitamin_a_mcg: (n.vitamin_a_mcg || 0) * ratio,
            vitamin_c_mg:  (n.vitamin_c_mg  || 0) * ratio,
        };

        return {
            breakdown: {
                ingredient: line,
                parsed: { name, searchTerm: usedTerm, weightGrams, unit, qty },
                cookingState,
                stats,
                source,
            },
            stats,
        };
    }

    static async analyze(
        ingredients: string[],
        dishContext: DishContext = 'standard',
    ): Promise<{ total: NutritionTotal, breakdown: any[] }> {
        // Process up to 4 ingredients concurrently to keep external API calls manageable
        const tasks = ingredients.map(line => () => NutritionEngine.lookupIngredient(line, dishContext));
        const results = await withConcurrency(tasks, 4);

        const total: NutritionTotal = {
            calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0,
            calcium_mg: 0, iron_mg: 0, vitamin_a_mcg: 0, vitamin_c_mg: 0,
        };
        const breakdown: any[] = [];

        for (const { breakdown: item, stats } of results) {
            breakdown.push(item);
            if (stats) {
                total.calories      += stats.calories;
                total.protein       += stats.protein;
                total.fat           += stats.fat;
                total.carbs         += stats.carbs;
                total.fiber         += stats.fiber;
                total.sugar         += stats.sugar;
                total.calcium_mg    += stats.calcium_mg;
                total.iron_mg       += stats.iron_mg;
                total.vitamin_a_mcg += stats.vitamin_a_mcg;
                total.vitamin_c_mg  += stats.vitamin_c_mg;
            }
        }

        total.calories      = Math.round(total.calories);
        total.protein       = Math.round(total.protein);
        total.fat           = Math.round(total.fat);
        total.carbs         = Math.round(total.carbs);
        total.fiber         = Math.round(total.fiber);
        total.sugar         = Math.round(total.sugar);
        total.calcium_mg    = Math.round(total.calcium_mg);
        total.iron_mg       = parseFloat(total.iron_mg.toFixed(1));
        total.vitamin_a_mcg = Math.round(total.vitamin_a_mcg);
        total.vitamin_c_mg  = parseFloat(total.vitamin_c_mg.toFixed(1));

        return { total, breakdown };
    }

    /**
     * Analyze a full recipe by name + ingredient list.
     * Auto-infers dish context from the recipe name so any caller gets
     * accurate cooking state without needing to know about DishContext.
     *
     * This is the canonical entry point for recipe-level nutrition analysis.
     * Use this from the auditor, JIT enrichment, worker, and API routes alike.
     *
     * Returns a nutrition object ready to store in the database (flat `total`
     * fields at the top level) plus provenance metadata.
     */
    static async analyzeRecipe(
        recipeName: string,
        ingredients: string[],
    ): Promise<{
        total: NutritionTotal;
        breakdown: any[];
        dishContext: DishContext;
        contextInferred: boolean;
        source: 'NutritionEngine';
        analyzedAt: string;
    }> {
        const { context: dishContext, inferred: contextInferred } = resolveContext(null, recipeName);
        // Defensive: filter out null / non-string entries that may arrive from
        // Supabase Json[] columns or poorly formatted crawled recipes.
        const safeIngredients = ingredients.filter(
            (i): i is string => typeof i === 'string' && i.trim().length > 0,
        );
        const { total, breakdown } = await this.analyze(safeIngredients, dishContext);
        return {
            total,
            breakdown,
            dishContext,
            contextInferred,
            source:      'NutritionEngine',
            analyzedAt:  new Date().toISOString(),
        };
    }
}
