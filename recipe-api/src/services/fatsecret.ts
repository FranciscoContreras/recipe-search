import dotenv from 'dotenv';

dotenv.config();

const CLIENT_ID = process.env.FATSECRET_CLIENT_ID;
const CLIENT_SECRET = process.env.FATSECRET_CLIENT_SECRET;
const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
const SEARCH_URL = 'https://platform.fatsecret.com/rest/server.api';

let accessToken: string | null = null;
let tokenExpiresAt: number = 0;

export async function getAccessToken(): Promise<string | null> {
    if (accessToken && Date.now() < tokenExpiresAt) {
        return accessToken;
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
        console.warn('FatSecret credentials missing.');
        return null;
    }

    try {
        const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
        const res = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'grant_type=client_credentials&scope=basic'
        });

        if (!res.ok) throw new Error(`Auth failed: ${res.statusText}`);

        const data = await res.json();
        accessToken = data.access_token;
        tokenExpiresAt = Date.now() + (data.expires_in * 1000) - 60000; // Buffer 1 min
        return accessToken;
    } catch (e) {
        console.error('FatSecret Auth Error:', e);
        return null;
    }
}

export async function findNutritionForRecipe(recipeName: string): Promise<any | null> {
    const token = await getAccessToken();
    if (!token) return null;

    try {
        // Search for the recipe/food item
        // Method: foods.search
        const params = new URLSearchParams({
            method: 'foods.search',
            search_expression: recipeName,
            format: 'json',
            max_results: '1' // Just get the top match
        });

        const res = await fetch(SEARCH_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: params
        });

        const data = await res.json();
        
        // Check if we found a food
        const food = data.foods?.food?.[0] || data.foods?.food; // FatSecret XML-to-JSON sometimes varies if array has 1 item
        if (!food) return null;

        // Ideally we'd get detailed nutrition, but search result often has basic calories/macros in 'food_description'
        // or we need to call food.get. Let's assume description has summary or fetch details.
        
        // Let's fetch full details for accuracy: food.get.v2
        const detailsParams = new URLSearchParams({
            method: 'food.get.v2',
            food_id: food.food_id,
            format: 'json'
        });

        const detailsRes = await fetch(SEARCH_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: detailsParams
        });

        const details = await detailsRes.json();
        const serving = details.food?.servings?.serving?.[0] || details.food?.servings?.serving;

        if (serving) {
            return {
                "@type": "NutritionInformation",
                "calories": `${serving.calories} kcal`,
                "carbohydrateContent": `${serving.carbohydrate} g`,
                "proteinContent": `${serving.protein} g`,
                "fatContent": `${serving.fat} g`,
                "fiberContent": `${serving.fiber} g`,
                "sugarContent": `${serving.sugar} g`
            };
        }

        return null;

    } catch (e) {
        console.error('FatSecret API Error:', e);
        return null;
    }
}

export interface SimpleNutrition {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    fiber: number;
    sugar: number;
    serving_size_g: number;
}

export async function searchFatSecret(query: string): Promise<SimpleNutrition | null> {
    const token = await getAccessToken();
    if (!token) return null;

    try {
        const params = new URLSearchParams({
            method: 'foods.search',
            search_expression: query,
            format: 'json',
            max_results: '1'
        });

        const res = await fetch(SEARCH_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: params
        });

        const data = await res.json();
        const food = data.foods?.food?.[0] || data.foods?.food;
        if (!food) {
            console.log(`DEBUG: FatSecret found no results for "${query}"`);
            return null;
        }

        const detailsParams = new URLSearchParams({
            method: 'food.get.v2',
            food_id: food.food_id,
            format: 'json'
        });

        const detailsRes = await fetch(SEARCH_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: detailsParams
        });

        const details = await detailsRes.json();
        const servings = details.food?.servings?.serving;
        // Prefer 100g serving if available, else first
        let serving = Array.isArray(servings) 
            ? servings.find((s: any) => s.metric_serving_unit === 'g' && s.metric_serving_amount === '100.000') || servings[0]
            : servings;

        if (!serving) return null;

        let servingWeight = 100;
        if (serving.metric_serving_unit === 'g' || serving.metric_serving_unit === 'ml') {
             servingWeight = parseFloat(serving.metric_serving_amount) || 100;
        }

        return {
            calories: parseFloat(serving.calories) || 0,
            protein: parseFloat(serving.protein) || 0,
            fat: parseFloat(serving.fat) || 0,
            carbs: parseFloat(serving.carbohydrate) || 0,
            fiber: parseFloat(serving.fiber) || 0,
            sugar: parseFloat(serving.sugar) || 0,
            serving_size_g: servingWeight
        };

    } catch (e) {
        console.error('FatSecret Search Error:', e);
        return null;
    }
}
