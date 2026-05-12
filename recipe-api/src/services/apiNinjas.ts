/**
 * API Ninjas Nutrition API — free tier: 10,000 req/month, no IP restrictions.
 * Best for: general fallback when USDA and Open Food Facts both miss.
 * Docs: https://api-ninjas.com/api/nutrition
 *
 * Set API_NINJAS_KEY in .env. Get a free key at https://api-ninjas.com
 * Returns per-100g macros for natural language queries.
 */

const BASE = 'https://api.api-ninjas.com/v1/nutrition';

export interface NinjaNutrition {
    calories:      number;
    protein:       number;
    fat:           number;
    carbs:         number;       // API field: carbohydrates_total_g
    fiber:         number;
    sugar:         number;
    sodium_mg:     number;
    cholesterol_mg: number;
    serving_size_g: number;
    // Micros not available in this API
    calcium_mg:    number;
    iron_mg:       number;
    vitamin_a_mcg: number;
    vitamin_c_mg:  number;
}

export async function searchApiNinjas(query: string): Promise<NinjaNutrition | null> {
    const API_KEY = process.env.API_NINJAS_KEY;
    if (!API_KEY) {
        // Silently skip — key is optional, this is a fallback source
        return null;
    }

    try {
        const controller = new AbortController();
        const timeout    = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(`${BASE}?query=${encodeURIComponent(query)}`, {
            headers: { 'X-Api-Key': API_KEY },
            signal:  controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
            console.warn(`API Ninjas HTTP ${res.status} for "${query}"`);
            return null;
        }

        const items: any[] = await res.json();
        if (!items || items.length === 0) return null;

        // The free tier returns the string "Only available for premium subscribers."
        // for calories and protein — completely unusable for nutrition calculation.
        const first = items[0];
        if (typeof first?.calories === 'string' || typeof first?.protein_g === 'string') {
            console.warn(`API Ninjas free tier: calories/protein unavailable for "${query}" (premium required)`);
            return null;
        }

        // Sum all items (API may split a query like "1 cup flour" into components)
        let totalCalories = 0, totalProtein = 0, totalFat = 0, totalCarbs = 0,
            totalFiber = 0, totalSugar = 0, totalSodium = 0, totalChol = 0,
            totalWeight = 0;

        for (const item of items) {
            totalCalories += item.calories         ?? 0;
            totalProtein  += item.protein_g        ?? 0;
            totalFat      += item.fat_total_g      ?? 0;
            totalCarbs    += item.carbohydrates_total_g ?? 0;
            totalFiber    += item.fiber_g          ?? 0;
            totalSugar    += item.sugar_g          ?? 0;
            totalSodium   += item.sodium_mg        ?? 0;
            totalChol     += item.cholesterol_mg   ?? 0;
            totalWeight   += item.serving_size_g   ?? 100;
        }

        // Normalise to per-100g so our ratio calculation works correctly
        const ratio = totalWeight > 0 ? 100 / totalWeight : 1;

        return {
            calories:       totalCalories  * ratio,
            protein:        totalProtein   * ratio,
            fat:            totalFat       * ratio,
            carbs:          totalCarbs     * ratio,
            fiber:          totalFiber     * ratio,
            sugar:          totalSugar     * ratio,
            sodium_mg:      totalSodium    * ratio,
            cholesterol_mg: totalChol      * ratio,
            calcium_mg:     0,   // not provided by this API
            iron_mg:        0,
            vitamin_a_mcg:  0,
            vitamin_c_mg:   0,
            serving_size_g: 100,
        };
    } catch (e: any) {
        if (e.name !== 'AbortError') {
            console.warn(`API Ninjas error for "${query}": ${e.message}`);
        }
        return null;
    }
}
