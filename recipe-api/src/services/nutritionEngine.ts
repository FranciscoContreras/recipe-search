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
}

export class NutritionEngine {
    
    // Normalize to grams. Very basic map.
    // Real implementation would use a library like 'convert-units'
    private static unitToGrams(unit: string, qty: number): number {
        const u = unit ? unit.toLowerCase() : '';
        if (['g', 'gram', 'grams'].includes(u)) return qty;
        if (['kg', 'kilogram'].includes(u)) return qty * 1000;
        if (['oz', 'ounce', 'ounces'].includes(u)) return qty * 28.35;
        if (['lb', 'pound', 'pounds'].includes(u)) return qty * 453.59;
        
        // Volumetric to weight is hard without density. We assume water density (1ml = 1g) as a baseline fallback
        if (['ml', 'milliliter'].includes(u)) return qty;
        if (['l', 'liter'].includes(u)) return qty * 1000;
        if (['cup', 'cups'].includes(u)) return qty * 236; // ~236ml
        if (['tbsp', 'tablespoon'].includes(u)) return qty * 15;
        if (['tsp', 'teaspoon'].includes(u)) return qty * 5;
        
        return 100; // Default fallback if no unit: assume "1 serving/piece" ~ 100g
    }

    static async analyze(ingredients: string[]): Promise<{ total: NutritionTotal, breakdown: any[] }> {
        console.log('DEBUG: Analyzing ingredients:', JSON.stringify(ingredients));
        const total: NutritionTotal = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0 };
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
            if (!parsed || !parsed.description) {
                // Try to capture "200g Item" or "200 g Item" or "2 cups Item"
                const regex = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\s+(.*)$/;
                const match = line.match(regex);
                if (match) {
                    parsed = {
                        quantity: parseFloat(match[1]),
                        unitOfMeasure: match[2] || null,
                        description: match[3]
                    };
                } else {
                    parsed = { description: line, quantity: 1, unitOfMeasure: null };
                }
            }

            const name = parsed.description || line; // Clean name
            const qty = parsed.quantity || 1;
            const unit = parsed.unitOfMeasure || '';
            const weightGrams = this.unitToGrams(unit, qty);

            console.log(`DEBUG: Parsed "${line}" -> Name: "${name}", Qty: ${qty}, Unit: "${unit}", Weight: ${weightGrams}g`);

            // 2. Check Cache
            let nutritionInfo: UsdaNutrition | SimpleNutrition | null = null;
            let source = 'usda';

            const { data: cached } = await supabase
                .from('ingredient_cache')
                .select('*')
                .eq('term', name.toLowerCase())
                .single();

            if (cached) {
                nutritionInfo = cached.nutrition as any;
                source = cached.source;
            } else {
                // 3. Fetch from USDA
                const usdaData = await searchUsda(name);
                if (usdaData) {
                    nutritionInfo = usdaData;
                    source = 'usda';
                    // Cache it
                    await supabase.from('ingredient_cache').upsert({
                        term: name.toLowerCase(),
                        nutrition: usdaData as any,
                        source: 'usda'
                    });
                } else {
                    // 4. Fallback to FatSecret
                    console.log(`DEBUG: USDA failed for "${name}", trying FatSecret...`);
                    const fsData = await searchFatSecret(name);
                    if (fsData) {
                        nutritionInfo = fsData;
                        source = 'fatsecret';
                         await supabase.from('ingredient_cache').upsert({
                            term: name.toLowerCase(),
                            nutrition: fsData as any,
                            source: 'fatsecret'
                        });
                    }
                }
            }

            // 5. Calculate contribution
            if (nutritionInfo) {
                const baseWeight = nutritionInfo.serving_size_g || 100;
                const ratio = weightGrams / baseWeight;
                
                const itemStats = {
                    calories: nutritionInfo.calories * ratio,
                    protein: nutritionInfo.protein * ratio,
                    fat: nutritionInfo.fat * ratio,
                    carbs: nutritionInfo.carbs * ratio,
                    fiber: nutritionInfo.fiber * ratio,
                    sugar: nutritionInfo.sugar * ratio
                };

                // Add to total
                total.calories += itemStats.calories;
                total.protein += itemStats.protein;
                total.fat += itemStats.fat;
                total.carbs += itemStats.carbs;
                total.fiber += itemStats.fiber;
                total.sugar += itemStats.sugar;

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

        return { total, breakdown };
    }
}
