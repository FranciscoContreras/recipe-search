import { supabase } from '../supabaseClient';
import { searchUsda } from './usda';
// @ts-ignore
import { parse } from 'parse-ingredient';

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
        const u = unit.toLowerCase();
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
        const total: NutritionTotal = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0 };
        const breakdown = [];

        for (const line of ingredients) {
            // 1. Parse
            let parsed;
            try {
                parsed = parse(line)[0]; // parse-ingredient returns array
            } catch (e) {
                // Fallback: assume the whole string is the ingredient name
                parsed = { description: line, quantity: 1, unitOfMeasure: null };
            }

            const name = parsed.description || line; // Clean name
            const qty = parsed.quantity || 1;
            const unit = parsed.unitOfMeasure || '';
            const weightGrams = this.unitToGrams(unit, qty);

            // 2. Check Cache
            let nutritionInfo = null;
            const { data: cached } = await supabase
                .from('ingredient_cache')
                .select('*')
                .eq('term', name.toLowerCase())
                .single();

            if (cached) {
                nutritionInfo = cached.nutrition;
            } else {
                // 3. Fetch from USDA
                const usdaData = await searchUsda(name);
                if (usdaData) {
                    nutritionInfo = usdaData;
                    // Cache it
                    await supabase.from('ingredient_cache').upsert({
                        term: name.toLowerCase(),
                        nutrition: usdaData,
                        source: 'usda'
                    });
                }
            }

            // 4. Calculate contribution
            if (nutritionInfo) {
                const ratio = weightGrams / 100; // Standard is 100g
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
                    source: cached ? 'cache' : 'usda'
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
