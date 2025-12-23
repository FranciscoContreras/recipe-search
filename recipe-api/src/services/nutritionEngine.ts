import { supabase } from '../supabaseClient';
import { searchUsda, UsdaNutrition } from './usda';
import { searchFatSecret, SimpleNutrition } from './fatsecret';

// Bypass TS import issues for this specific library
const parse = require('parse-ingredient');

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

export class NutritionEngine {
    
    // Normalize to grams. Very basic map.
    // Real implementation would use a library like 'convert-units'
    private static unitToGrams(unit: string, qty: number): number {
        const u = unit ? unit.toLowerCase().replace(/s$/, '') : ''; // singularize
        
        // Weight
        if (['g', 'gram'].includes(u)) return qty;
        if (['kg', 'kilogram'].includes(u)) return qty * 1000;
        if (['oz', 'ounce'].includes(u)) return qty * 28.35;
        if (['lb', 'pound'].includes(u)) return qty * 453.59;
        
        // Volume (water density assumption)
        if (['ml', 'milliliter'].includes(u)) return qty;
        if (['l', 'liter'].includes(u)) return qty * 1000;
        if (['cup', 'c'].includes(u)) return qty * 236; 
        if (['tbsp', 'tablespoon', 'tbs', 'T'].includes(u)) return qty * 15;
        if (['tsp', 'teaspoon', 'tspn', 't'].includes(u)) return qty * 5;
        if (['fl oz', 'floz'].includes(u)) return qty * 29.57;
        if (['pint', 'pt'].includes(u)) return qty * 473;
        if (['quart', 'qt'].includes(u)) return qty * 946;
        if (['gallon', 'gal'].includes(u)) return qty * 3785;

        // Abstract
        if (['pinch', 'pn'].includes(u)) return qty * 0.3;
        if (['dash'].includes(u)) return qty * 0.6;
        if (['slice'].includes(u)) return qty * 30; // bread/cheese avg
        if (['clove'].includes(u)) return qty * 5; // garlic
        
        return 100; // Default fallback if no unit: assume "1 serving/piece" ~ 100g
    }

    // Helper to parse "1 1/2", "1/2", "1.5"
    private static parseQuantity(qtyStr: string): number {
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

    static async analyze(ingredients: string[]): Promise<{ total: NutritionTotal, breakdown: any[] }> {
        console.log('DEBUG: Analyzing ingredients:', JSON.stringify(ingredients));
        const total: NutritionTotal = { 
            calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0,
            calcium_mg: 0, iron_mg: 0, vitamin_a_mcg: 0, vitamin_c_mg: 0
        };
        const breakdown = [];

        for (const line of ingredients) {
            console.log('DEBUG: Processing line:', line);
            // 1. Parse
            let parsed;
            try {
                const results = parse(line);
                parsed = Array.isArray(results) ? results[0] : results; 
            } catch (e) {
                parsed = null;
            }

            // Manual Regex Fallback if library fails
            // Enhanced regex for "1 1/2 cups", "1/2 tsp", "1.5 g"
            if (!parsed || !parsed.description) {
                const regex = /^((?:\d+\s+)?\d+\/\d+|\d+(?:\.\d+)?|\d+)\s*([a-zA-Z]+)?\s+(.*)$/;
                const match = line.match(regex);
                if (match) {
                    parsed = {
                        quantity: this.parseQuantity(match[1]),
                        unitOfMeasure: match[2] || null,
                        description: match[3]
                    };
                } else {
                    parsed = { description: line, quantity: 1, unitOfMeasure: null };
                }
            }

            const name = parsed.description || line; 
            const qty = typeof parsed.quantity === 'string' ? this.parseQuantity(parsed.quantity) : (parsed.quantity || 1);
            const unit = parsed.unitOfMeasure || '';
            const weightGrams = this.unitToGrams(unit, qty);

            // Cache Versioning: Force new cache by prefixing
            const cacheKey = `v8:${name.toLowerCase()}`;

            // 2. Check Cache
            let nutritionInfo: UsdaNutrition | SimpleNutrition | null = null;
            let source = 'usda';

            const { data: cached } = await supabase
                .from('ingredient_cache')
                .select('*')
                .eq('term', cacheKey)
                .single();

            if (cached) {
                nutritionInfo = cached.nutrition as any;
                source = cached.source;
            } else {
                // 3. Fetch from USDA (Fresh)
                console.log(`DEBUG: Cache miss for "${cacheKey}". Fetching fresh data for "${name}"...`);
                const usdaData = await searchUsda(name);
                if (usdaData) {
                    nutritionInfo = usdaData;
                    source = 'usda';
                    await supabase.from('ingredient_cache').upsert({ term: cacheKey, nutrition: usdaData as any, source: 'usda' });
                } else {
                    // 4. Fallback to FatSecret
                    console.log(`DEBUG: USDA failed for "${name}", trying FatSecret...`);
                    const fsData = await searchFatSecret(name);
                    if (fsData) {
                        nutritionInfo = fsData;
                        source = 'fatsecret';
                        await supabase.from('ingredient_cache').upsert({ term: cacheKey, nutrition: fsData as any, source: 'fatsecret' });
                    }
                }
            }

            // 5. Calculate contribution
            if (nutritionInfo) {
                const baseWeight = nutritionInfo.serving_size_g || 100;
                const ratio = weightGrams / baseWeight;
                
                // Safe access for micros which might not exist in cached/FatSecret data
                const n = nutritionInfo as any; 

                const itemStats = {
                    calories: (n.calories || 0) * ratio,
                    protein: (n.protein || 0) * ratio,
                    fat: (n.fat || 0) * ratio,
                    carbs: (n.carbs || 0) * ratio,
                    fiber: (n.fiber || 0) * ratio,
                    sugar: (n.sugar || 0) * ratio,
                    calcium_mg: (n.calcium_mg || 0) * ratio,
                    iron_mg: (n.iron_mg || 0) * ratio,
                    vitamin_a_mcg: (n.vitamin_a_mcg || 0) * ratio,
                    vitamin_c_mg: (n.vitamin_c_mg || 0) * ratio
                };

                // Add to total
                total.calories += itemStats.calories;
                total.protein += itemStats.protein;
                total.fat += itemStats.fat;
                total.carbs += itemStats.carbs;
                total.fiber += itemStats.fiber;
                total.sugar += itemStats.sugar;
                total.calcium_mg += itemStats.calcium_mg;
                total.iron_mg += itemStats.iron_mg;
                total.vitamin_a_mcg += itemStats.vitamin_a_mcg;
                total.vitamin_c_mg += itemStats.vitamin_c_mg;

                breakdown.push({
                    ingredient: line,
                    parsed: { name, weightGrams },
                    stats: itemStats,
                    source: source
                });
            } else {
                breakdown.push({ ingredient: line, status: 'not_found' });
            }
        }

        // Round totals
        total.calories = Math.round(total.calories);
        total.protein = Math.round(total.protein);
        total.fat = Math.round(total.fat);
        total.carbs = Math.round(total.carbs);
        total.calcium_mg = Math.round(total.calcium_mg);
        total.iron_mg = parseFloat(total.iron_mg.toFixed(1));
        total.vitamin_a_mcg = Math.round(total.vitamin_a_mcg);
        total.vitamin_c_mg = parseFloat(total.vitamin_c_mg.toFixed(1));

        return { total, breakdown };
    }
}
