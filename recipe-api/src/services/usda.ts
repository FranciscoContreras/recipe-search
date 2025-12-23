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
    portions?: { measure: string; gramWeight: number }[];
}

export async function searchUsda(query: string): Promise<UsdaNutrition | null> {
    console.log(`DEBUG: USDA Searching for "${query}"`);
    if (!API_KEY) {
        console.warn('USDA API Key missing.');
        return null;
    }

    try {
        const encodedQuery = encodeURIComponent(query);
        const url = `${BASE_URL}/foods/search?api_key=${API_KEY}&query=${encodedQuery}&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS)&pageSize=5`;
        
        console.log(`DEBUG: Fetching URL: ${url.replace(API_KEY, '***')}`);

        const searchRes = await axios.get(url);
        const foods = searchRes.data.foods || [];
        
        if (foods.length === 0) {
            console.log(`DEBUG: USDA found no results for "${query}"`);
            return null;
        }

        // 1. Filter out Branded if possible
        let candidates = foods.filter((f: any) => f.dataType !== 'Branded');
        if (candidates.length === 0) candidates = foods;

        // 2. Filter out processed/mixed items if user didn't ask for them
        const queryLower = query.toLowerCase();
        const processingTerms = /dried|dehydrated|powder|chip|candied|syrup|baked|fried|roasted|grilled|boiled|stewed|canned|cooked|mix|soup|stew|salad/i;
        const wantsProcessed = processingTerms.test(queryLower);
        
        if (!wantsProcessed) {
            const cleanCandidates = candidates.filter((f: any) => !processingTerms.test(f.description));
            if (cleanCandidates.length > 0) candidates = cleanCandidates;
        }

        // 3. Score candidates
        // Priority: Starts With Query > SR Legacy > Foundation > Survey
        const getScore = (f: any) => {
            let score = 0;
            const desc = f.description.toLowerCase();
            const q = queryLower.trim();

            // Match Quality
            if (desc === q) score += 500; // Exact match
            else if (desc.startsWith(q + ',') || desc.startsWith(q + ' ')) score += 300; // "Milk, whole"
            else if (desc.includes(q)) score += 10; // Contains
            else score -= 1000;

            // Data Source Quality
            if (f.dataType === 'SR Legacy') score += 100;
            else if (f.dataType === 'Foundation') score += 90;
            else if (f.dataType === 'Survey (FNDDS)') score += 50;

            // Penalty for extra words (shorter is better)
            score -= desc.length; 

            // Calorie Sanity Check
            const energy = f.foodNutrients.find((n: any) => n.nutrientId === 1008)?.value || 0;
            const isLowCal = /water|salt|diet|tea|coffee|soda|coke|pepsi|spice|seasoning|baking powder|baking soda/i.test(q);
            
            if (energy === 0 && !isLowCal) {
                score -= 200;
            }

            return score;
        };

        candidates.sort((a: any, b: any) => getScore(b) - getScore(a));
        
        let foodCandidate = candidates[0];
        const isLowCal = /water|salt|diet|tea|coffee|soda|coke|pepsi|spice|seasoning|baking powder|baking soda/i.test(queryLower);
        
        if (foodCandidate && !isLowCal) {
            for (const candidate of candidates) {
                const cal = candidate.foodNutrients.find((n: any) => n.nutrientId === 1008)?.value;
                if (cal > 0) {
                    foodCandidate = candidate;
                    break;
                }
            }
        }

        if (!foodCandidate) return null;

        console.log(`DEBUG: Selected Food Candidate: ${foodCandidate.description} (ID: ${foodCandidate.fdcId})`);

        // 4. Fetch Full Details (for Portions)
        const detailsUrl = `${BASE_URL}/food/${foodCandidate.fdcId}?api_key=${API_KEY}`;
        const detailsRes = await axios.get(detailsUrl);
        const food = detailsRes.data;

        const nutrients = food.foodNutrients;
        const getVal = (id: number) => {
            // Details endpoint structure slightly different: nutrient.nutrient.id or nutrient.id depending on version
            // Usually foodNutrients array has object with 'nutrient' object inside or flat.
            // Foundation/SR Legacy details: { nutrient: { id: 1008 }, amount: 123 }
            const n = nutrients.find((x: any) => (x.nutrient?.id === id || x.nutrient?.number === id.toString() || x.nutrientId === id));
            return n ? (n.amount !== undefined ? n.amount : n.value) : 0;
        };

        // Extract Portions
        let portions: { measure: string, gramWeight: number }[] = [];
        if (food.foodPortions) {
             portions = food.foodPortions.map((p: any) => ({
                 measure: p.measureUnit?.name || p.modifier || 'unit',
                 gramWeight: p.gramWeight
             }));
        }

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
            serving_size_g: 100, // Details are usually normalized to 100g base for nutrients
            portions: portions
        };

    } catch (e: any) {
        console.error('USDA API Error:', e.message);
        return null;
    }
}