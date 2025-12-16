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
