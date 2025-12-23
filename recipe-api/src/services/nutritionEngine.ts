import { supabase } from '../supabaseClient';
import { searchUsda, UsdaNutrition } from './usda';
import { searchFatSecret, SimpleNutrition } from './fatsecret';
import { cleanIngredientTerm } from '../utils/cleaning';

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

const DENSITY_TABLE: Record<string, number> = {
    // value = grams per ml (water = 1.0)
    'flour': 0.55,       // ~125g / cup (236ml)
    'sugar': 0.85,       // ~200g / cup
    'brown sugar': 0.93, // ~220g / cup
    'butter': 0.96,      // ~227g / cup
    'oil': 0.92,         // ~216g / cup
    'oats': 0.40,        // ~95g / cup
    'rice': 0.85,        // ~200g / cup (raw)
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
    'lettuce': 0.15
};

export class NutritionEngine {
    
    private static getDensity(ingredientName: string): number {
        const lowerName = ingredientName.toLowerCase();
        for (const [key, density] of Object.entries(DENSITY_TABLE)) {
            if (lowerName.includes(key)) {
                return density;
            }
        }
        return 1.0; // Default to water density
    }

    private static unitToGrams(unit: string, qty: number, ingredientName: string): number {
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
        else if (['tbsp', 'tablespoon', 'tbs', 'T'].includes(u)) volumeMl = qty * 14.79;
        else if (['tsp', 'teaspoon', 'tspn', 't'].includes(u)) volumeMl = qty * 4.93;
        else if (['fl oz', 'floz'].includes(u)) volumeMl = qty * 29.57;
        else if (['pint', 'pt'].includes(u)) volumeMl = qty * 473.18;
        else if (['quart', 'qt'].includes(u)) volumeMl = qty * 946.35;
        else if (['gallon', 'gal'].includes(u)) volumeMl = qty * 3785.41;

        // Abstract / Count
        else if (['pinch', 'pn'].includes(u)) weightG = qty * 0.3; // Salt assumption
        else if (['dash'].includes(u)) weightG = qty * 0.6;
        else if (['slice'].includes(u)) weightG = qty * 30; // bread/cheese avg
        else if (['clove'].includes(u)) weightG = qty * 5; // garlic
        else {
            // No unit (e.g. "2 apples") or Unknown unit
            // Count-based assumptions
            const lowerName = ingredientName.toLowerCase();
            let unitWeight = 100; // Default

            if (lowerName.includes('egg')) unitWeight = 50;
            else if (lowerName.includes('banana')) unitWeight = 120;
            else if (lowerName.includes('apple')) unitWeight = 180;
            else if (lowerName.includes('slice')) unitWeight = 30; // "slice of bread"
            else if (lowerName.includes('bread')) unitWeight = 30; // "2 bread" -> 2 slices
            else if (lowerName.includes('chicken') && (lowerName.includes('breast') || lowerName.includes('thigh'))) unitWeight = 200; 
            else if (lowerName.includes('avocado')) unitWeight = 150;
            else if (lowerName.includes('onion')) unitWeight = 110;
            else if (lowerName.includes('carrot')) unitWeight = 60;
            else if (lowerName.includes('potato')) unitWeight = 213;

            return qty * unitWeight;
        }

        if (weightG > 0) return weightG;

        // Convert Volume to Weight using Density
        if (volumeMl > 0) {
            const density = this.getDensity(ingredientName);
            return volumeMl * density;
        }

        return 100 * qty;
    }

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
        const total: NutritionTotal = { 
            calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0,
            calcium_mg: 0, iron_mg: 0, vitamin_a_mcg: 0, vitamin_c_mg: 0
        };
        const breakdown = [];

        for (const line of ingredients) {
            // 1. Parse
            let parsed;
            try {
                const results = parse(line);
                parsed = Array.isArray(results) ? results[0] : results; 
            } catch (e) {
                parsed = null;
            }

            // Fallback Regex
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
            
            // Clean name for Search
            const searchName = cleanIngredientTerm(name);

            // Cache Versioning
            const cacheKey = `v9:${searchName.toLowerCase()}`; // Bumped version

            // 2. Check Cache / Fetch
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
                const usdaData = await searchUsda(searchName);
                if (usdaData) {
                    nutritionInfo = usdaData;
                    source = 'usda';
                    // Async Cache Update
                    supabase.from('ingredient_cache').upsert({ term: cacheKey, nutrition: usdaData as any, source: 'usda' }).then();
                } else {
                    // 4. Fallback to FatSecret
                    const fsData = await searchFatSecret(searchName);
                    if (fsData) {
                        nutritionInfo = fsData;
                        source = 'fatsecret';
                         supabase.from('ingredient_cache').upsert({ term: cacheKey, nutrition: fsData as any, source: 'fatsecret' }).then();
                    }
                }
            }

            // 5. Calculate Weight (Prioritize Portions)
            let weightGrams = 0;
            // First estimate (fallback logic)
            weightGrams = this.unitToGrams(unit, qty, name);

            if (nutritionInfo && (nutritionInfo as any).portions) {
                 const portions = (nutritionInfo as any).portions;
                 const u = unit ? unit.toLowerCase().replace(/s$/, '') : '';
                 
                 let match = portions.find((p: any) => {
                     const pm = p.measure.toLowerCase();
                     if (u === 'cup' && pm.includes('cup')) return true;
                     if ((u === 'tbsp' || u === 'tablespoon') && (pm.includes('tbsp') || pm.includes('tablespoon'))) return true;
                     if ((u === 'tsp' || u === 'teaspoon') && (pm.includes('tsp') || pm.includes('teaspoon'))) return true;
                     if (u === 'slice' && pm.includes('slice')) return true;
                     if (u === 'oz' && pm.includes('oz')) return true;
                     // Count logic for USDA (e.g. "large", "small", "medium") - often "unit" or "item" isn't explicit but modifier is
                     if (u === '' && (pm.includes('large') || pm.includes('small') || pm.includes('medium') || pm.includes('item') || pm.includes('whole'))) return true;
                     return false;
                 });

                 if (match) {
                     console.log(`DEBUG: Found USDA portion match for "${name}": ${match.measure} = ${match.gramWeight}g`);
                     weightGrams = match.gramWeight * qty;
                 }
            }

            // 6. Calculate contribution
            if (nutritionInfo) {
                const baseWeight = nutritionInfo.serving_size_g || 100;
                const ratio = weightGrams / baseWeight;
                
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
                    parsed: { name, searchName, weightGrams, unit, qty },
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
