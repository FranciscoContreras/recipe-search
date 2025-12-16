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
    SUGAR: 2000
};

export interface UsdaNutrition {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    fiber: number;
    sugar: number;
    serving_size_g?: number; // Standard is usually 100g for reference, but sometimes detailed
}

export async function searchUsda(query: string): Promise<UsdaNutrition | null> {
    console.log(`DEBUG: USDA Searching for "${query}"`);
    if (!API_KEY) {
        console.warn('USDA API Key missing.');
        return null;
    }

    try {
        // 1. Search for the food
        // Removing dataType filter to avoid axios array serialization issues and broaden search
        const searchRes = await axios.get(`${BASE_URL}/foods/search`, {
            params: {
                api_key: API_KEY,
                query: query,
                pageSize: 1
            }
        });

        console.log(`DEBUG: USDA Response Status: ${searchRes.status}, Items: ${searchRes.data.foods?.length}`);

        const food = searchRes.data.foods?.[0];
        if (!food) return null;

        // 2. Extract Nutrients (Search results usually contain them, no need for second call often)
        // The search result format flattens nutrients slightly differently than detailed view,
        // but 'foodNutrients' array is usually present.
        
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
            serving_size_g: 100 // USDA standard search results are typically normalized to 100g or have a serving size
        };

    } catch (e: any) {
        console.error('USDA API Error:', e.message);
        return null;
    }
}
