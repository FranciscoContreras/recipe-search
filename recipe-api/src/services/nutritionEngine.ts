import { supabase } from '../supabaseClient';
import { searchUsda, UsdaNutrition } from './usda';
import { searchFatSecret, SimpleNutrition } from './fatsecret';
import { searchOpenFoodFacts, OffNutrition } from './openFoodFacts';
import { cleanIngredientTerm, getSearchTerms } from '../utils/cleaning';
import { detectCookingState, resolveCookingState, getCookedDensity, CookingState, DishContext } from '../utils/cookingState';

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

const DENSITY_TABLE: Record<string, number> = {
    // value = grams per ml (water = 1.0)
    'flour': 0.55,       // ~125g / cup (236ml)
    'sugar': 0.85,       // ~200g / cup
    'brown sugar': 0.93, // ~220g / cup
    'butter': 0.96,      // ~227g / cup
    'oil': 0.92,         // ~216g / cup
    'oats': 0.40,        // ~95g / cup
    'rice': 0.85,        // ~200g / cup (raw)
    'wheat berries': 0.80,
    'quinoa': 0.75,
    'couscous': 0.60,
    'milk': 1.03,
    'cream': 1.01,
    'honey': 1.42,
    'molasses': 1.40,
    'syrup': 1.35,
    'water': 1.0,
    'cocoa': 0.45,
    'powdered sugar': 0.50,
    'cornstarch': 0.55,
    'cheese': 0.45, // Grated/Shredded loosely
    'nuts': 0.60,   // Chopped
    'spinach': 0.12, // Raw leaves, loosely packed
    'lettuce': 0.15,
    'parsley': 0.15,
    'cilantro': 0.15,
    'basil': 0.15,
    'mint': 0.15,
    'herb': 0.15
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

        // Abstract / Count
        else if (['pinch', 'pn'].includes(u)) weightG = qty * 0.3;
        else if (['dash'].includes(u)) weightG = qty * 0.6;
        else if (['slice'].includes(u)) weightG = qty * 30; // bread/cheese avg
        else if (['clove'].includes(u)) weightG = qty * 5; // garlic
        else {
            // No unit (e.g. "2 apples") or unknown unit — count-based assumptions
            const lowerName = ingredientName.toLowerCase();

            const spiceKeywords = ['salt', 'pepper', 'cinnamon', 'paprika', 'cumin', 'turmeric',
                                   'oregano', 'thyme', 'rosemary', 'basil', 'parsley', 'cilantro',
                                   'dill', 'chive', 'sage', 'bay leaf', 'vanilla', 'extract',
                                   'powder', 'seasoning', 'spice', 'clove', 'nutmeg', 'ginger'];
            if (spiceKeywords.some(k => lowerName.includes(k))) return qty * 2;

            let unitWeight = 100; // Default — more specific checks must come first
            if      (lowerName.includes('egg yolk'))  unitWeight = 17;  // 1 yolk ≈ 17g
            else if (lowerName.includes('egg white')) unitWeight = 33;  // 1 white ≈ 33g
            else if (lowerName.includes('egg'))       unitWeight = 50;  // whole egg ≈ 50g
            else if (lowerName.includes('banana'))    unitWeight = 120;
            else if (lowerName.includes('apple'))     unitWeight = 180;
            else if (lowerName.includes('romaine'))   unitWeight = 500; // 1 head romaine ≈ 500g
            else if (lowerName.includes('lettuce'))   unitWeight = 400; // 1 head generic lettuce
            else if (lowerName.includes('cabbage'))   unitWeight = 900;
            else if (lowerName.includes('slice'))     unitWeight = 30;
            else if (lowerName.includes('bread'))     unitWeight = 30;
            else if (lowerName.includes('chicken') && (lowerName.includes('breast') || lowerName.includes('thigh'))) unitWeight = 200;
            else if (lowerName.includes('avocado'))   unitWeight = 150;
            else if (lowerName.includes('onion'))     unitWeight = 110;
            else if (lowerName.includes('carrot'))    unitWeight = 60;
            else if (lowerName.includes('potato'))    unitWeight = 213;
            else if (lowerName.includes('tomato'))    unitWeight = 120;
            else if (lowerName.includes('pepper') && !spiceKeywords.some(k => lowerName.includes(k))) unitWeight = 150;
            else if (lowerName.includes('lemon'))     unitWeight = 60;
            else if (lowerName.includes('lime'))      unitWeight = 45;

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

        // Fall through: no size qualifier — for a plain count ("2 apples") use medium
        const medium = portions.find(p => {
            const pm = p.measure.toLowerCase();
            return pm.includes('medium') || pm.includes('whole') || pm.includes('piece');
        });
        if (medium) return medium.gramWeight * qty;

        return null;
    }

    // Looks up nutrition for a single ingredient line with a multi-strategy search.
    private static async lookupIngredient(
        line: string,
        dishContext: DishContext = 'standard',
    ): Promise<{ breakdown: any; stats: NutritionTotal | null }> {
        // Normalise unicode fractions so the parser handles them
        const processedLine = line
            .replace(/½/g, ' 1/2 ').replace(/⅓/g, ' 1/3 ').replace(/⅔/g, ' 2/3 ')
            .replace(/¼/g, ' 1/4 ').replace(/¾/g, ' 3/4 ')
            .replace(/⅕/g, ' 1/5 ').replace(/⅖/g, ' 2/5 ').replace(/⅗/g, ' 3/5 ').replace(/⅘/g, ' 4/5 ')
            .replace(/⅙/g, ' 1/6 ').replace(/⅚/g, ' 5/6 ')
            .replace(/⅛/g, ' 1/8 ').replace(/⅜/g, ' 3/8 ').replace(/⅝/g, ' 5/8 ').replace(/⅞/g, ' 7/8 ');

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

        // 3. Cache lookup
        let nutritionInfo: UsdaNutrition | SimpleNutrition | null = null;
        let source    = 'usda';
        let usedTerm  = primaryTerm;

        const { data: cached } = await supabase
            .from('ingredient_cache')
            .select('*')
            .eq('term', cacheKey)
            .single();

        if (cached) {
            nutritionInfo = cached.nutrition as any;
            source        = cached.source;
        } else {
            // Detect packaged/branded foods — route to Open Food Facts first
            const isPackaged = looksLikePackagedFood(name);

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
                        nutritionInfo = offData as any; source = 'openfoodfacts'; usedTerm = term;
                        supabase.from('ingredient_cache')
                            .upsert({ term: cacheKey, nutrition: offData as any, source: 'openfoodfacts' })
                            .then();
                        break;
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

        const portionWeight = this.resolveWeightFromPortions(portions ?? [], unit, qty);
        const weightGrams   = portionWeight ?? this.unitToGrams(unit, qty, name, cookingState);

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
}
