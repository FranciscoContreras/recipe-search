import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.USDA_API_KEY;
const BASE_URL = 'https://api.nal.usda.gov/fdc/v1';

// Nutrient IDs in USDA Foundation Foods
const NUTRIENT_IDS = {
    ENERGY_KCAL: 1008,
    PROTEIN: 1003,
    FAT: 1004,
    CARBS: 1005,
    FIBER: 1079,
    SUGAR: 2000,
    // Micros
    CALCIUM: 1087,
    IRON: 1089,
    VITAMIN_A: 1106, // RAE
    VITAMIN_C: 1162
};

export interface UsdaNutrition {
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
    serving_size_g?: number; 
}

export async function searchUsda(query: string): Promise<UsdaNutrition | null> {
    console.log(`DEBUG: USDA Searching for "${query}"`);
    if (!API_KEY) {
        console.warn('USDA API Key missing.');
        return null;
    }

    try {
        const encodedQuery = encodeURIComponent(query);
        // Explicitly requesting Foundation/Survey data to avoid branded candy/processed items
        const url = `${BASE_URL}/foods/search?api_key=${API_KEY}&query=${encodedQuery}&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS)&pageSize=5`;
        
        console.log(`DEBUG: Fetching URL: ${url.replace(API_KEY, '***')}`);

        const searchRes = await axios.get(url);

        console.log(`DEBUG: USDA Response Status: ${searchRes.status}, Items: ${searchRes.data.foods?.length}`);

        const foods = searchRes.data.foods || [];
        
        if (foods.length === 0) {
            console.log(`DEBUG: USDA found no results for "${query}"`);
            return null;
        }

        // Client-side priority: Skip Branded AND Processed (dried/powder/cooked) if query didn't ask for it
        const queryLower = query.toLowerCase();
        // Check if user explicitly asked for any processing
        const processingTerms = /dried|dehydrated|powder|chip|candied|syrup|baked|fried|roasted|grilled|boiled|stewed|canned|cooked/i;
        const wantsProcessed = processingTerms.test(queryLower);
        
        const isProcessed = (desc: string) => {
            if (wantsProcessed) return false; // User asked for it
            // Filter out items that mention processing if user didn't ask
            return processingTerms.test(desc);
        };

        // 1. Try to find Non-Branded AND Non-Processed
        let food = foods.find((f: any) => f.dataType !== 'Branded' && !isProcessed(f.description));
        
        // 2. Fallback: Any Non-Branded
        if (!food) {
            food = foods.find((f: any) => f.dataType !== 'Branded');
        }
        
        // 3. Last Resort: Top Result
        if (!food) food = foods[0];

        console.log(`DEBUG: Selected Food: ${food.description} (${food.dataType})`);

        const nutrients = food.foodNutrients;
        const getVal = (id: number) => {
            const n = nutrients.find((x: any) => x.nutrientId === id);
            return n ? n.value : 0;
        };

        return {
            calories: getVal(NUTRIENT_IDS.ENERGY_KCAL),
            protein: getVal(NUTRIENT_IDS.PROTEIN),
            fat: getVal(NUTRIENT_IDS.FAT),
            carbs: getVal(NUTRIENT_IDS.CARBS),
            fiber: getVal(NUTRIENT_IDS.FIBER),
            sugar: getVal(NUTRIENT_IDS.SUGAR),
            calcium_mg: getVal(NUTRIENT_IDS.CALCIUM),
            iron_mg: getVal(NUTRIENT_IDS.IRON),
            vitamin_a_mcg: getVal(NUTRIENT_IDS.VITAMIN_A),
            vitamin_c_mg: getVal(NUTRIENT_IDS.VITAMIN_C),
            serving_size_g: 100 // USDA standard search results are typically normalized to 100g or have a serving size
        };

    } catch (e: any) {
        console.error('USDA API Error:', e.message);
        return null;
    }
}