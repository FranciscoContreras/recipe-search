import dotenv from 'dotenv';
import path from 'path';
import axios from 'axios';
// @ts-ignore
const parse = require('parse-ingredient');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const USDA_KEY = process.env.USDA_API_KEY;

// Mock NUTRIENT_IDS from usda.ts
const NUTRIENT_IDS = {
    ENERGY_KCAL: 1008,
    PROTEIN: 1003,
    FAT: 1004,
    CARBS: 1005,
    FIBER: 1079,
    SUGAR: 2000
};

async function testSearch(term: string, useFilter = false) {
    console.log(`\n--- SEARCHING FOR: "${term}" (Filter: ${useFilter}) ---`);
    if (!USDA_KEY) { console.log('No USDA Key'); return; }

    const params: any = { api_key: USDA_KEY, query: term, pageSize: 3 };
    if (useFilter) {
        params.dataType = 'Foundation,SR Legacy,Survey (FNDDS)';
    }

    try {
        const res = await axios.get('https://api.nal.usda.gov/fdc/v1/foods/search', { params });
        // ... (rest same)
        
        const foods = res.data.foods;
        if (!foods || foods.length === 0) {
            console.log('No results found.');
            return;
        }

        foods.forEach((food: any, index: number) => {
            console.log(`
[${index + 1}] ${food.description} (ID: ${food.fdcId})`);
            console.log(`    Category: ${food.foodCategory}`);
            console.log(`    Data Type: ${food.dataType}`);
            
            const nutrients = food.foodNutrients;
            const getVal = (id: number) => {
                const n = nutrients.find((x: any) => x.nutrientId === id);
                return n ? n.value : 0;
            };
            console.log(`    Calories: ${getVal(1008)}`);
            console.log(`    Sugar: ${getVal(2000)}`);
        });

    } catch (e: any) {
        console.error('USDA Error:', e.message);
    }
}

async function testFatSecret(term: string) {
    if (!process.env.FATSECRET_CLIENT_ID) return;
    console.log(`\n--- FATSECRET SEARCH: "${term}" ---`);
    
    // Auth
    const auth = Buffer.from(`${process.env.FATSECRET_CLIENT_ID}:${process.env.FATSECRET_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://oauth.fatsecret.com/connect/token', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials&scope=basic'
    });
    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;

    // Search
    const searchRes = await fetch('https://platform.fatsecret.com/rest/server.api', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: new URLSearchParams({ method: 'foods.search', search_expression: term, format: 'json' })
    });
    const data = await searchRes.json();
    const food = data.foods?.food?.[0];
    
    if (food) {
        console.log(`[1] ${food.food_name} (ID: ${food.food_id})`);
        console.log(`    Description: ${food.food_description}`);
    } else {
        console.log('No results.');
    }
}

async function run() {
    await testSearch('bread raw', true);
    await testSearch('milk raw', true);
    await testSearch('butter raw', true);
    await testSearch('rice raw', true);
}

run();