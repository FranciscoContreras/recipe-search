import dotenv from 'dotenv';
import path from 'path';
import axios from 'axios';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const USDA_KEY = process.env.USDA_API_KEY;
const FAT_ID = process.env.FATSECRET_CLIENT_ID;
const FAT_SECRET = process.env.FATSECRET_CLIENT_SECRET;

console.log('--- KEY CHECK ---');
console.log(`USDA_API_KEY: ${USDA_KEY ? 'Present (' + USDA_KEY.substring(0,4) + '...)' : 'MISSING'}`);
console.log(`FATSECRET_CLIENT_ID: ${FAT_ID ? 'Present' : 'MISSING'}`);
console.log(`FATSECRET_CLIENT_SECRET: ${FAT_SECRET ? 'Present' : 'MISSING'}`);

async function testUsda() {
    if (!USDA_KEY) return;
    console.log('\n--- USDA TEST ---');
    try {
        const query = 'chicken breast';
        console.log(`Searching USDA for: "${query}"`);
        const res = await axios.get('https://api.nal.usda.gov/fdc/v1/foods/search', {
            params: { api_key: USDA_KEY, query: query, pageSize: 1 }
        });
        console.log(`Status: ${res.status}`);
        console.log(`Found: ${res.data.foods?.length} items`);
        if (res.data.foods?.[0]) {
            console.log(`Top Result: ${res.data.foods[0].description}`);
            console.log(`Nutrients: ${JSON.stringify(res.data.foods[0].foodNutrients?.length)} found`);
        }
    } catch (e: any) {
        console.error(`FAILED: ${e.message}`);
        if (e.response) console.error(`Data: ${JSON.stringify(e.response.data)}`);
    }
}

async function testFatSecret() {
    if (!FAT_ID || !FAT_SECRET) return;
    console.log('\n--- FATSECRET TEST ---');
    try {
        const auth = Buffer.from(`${FAT_ID}:${FAT_SECRET}`).toString('base64');
        // ... auth ...
        const res = await fetch('https://oauth.fatsecret.com/connect/token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'grant_type=client_credentials&scope=basic'
        });
        
        if (!res.ok) {
            // ... error ...
            return;
        }
        
        const data = await res.json();
        const token = data.access_token;
        console.log(`Auth SUCCESS. Token: ${token.substring(0, 10)}...`);

        // Test Search
        const query = 'chicken breast';
        console.log(`Searching FatSecret for: "${query}"`);
        const searchRes = await fetch('https://platform.fatsecret.com/rest/server.api', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: new URLSearchParams({
                method: 'foods.search',
                search_expression: query,
                format: 'json',
                max_results: '1'
            })
        });
        const searchData = await searchRes.json();
        const food = searchData.foods?.food?.[0] || searchData.foods?.food;
        if (food) {
            console.log(`Top Result: ${food.food_name} (ID: ${food.food_id})`);
        } else {
            console.log('No results found.');
        }

    } catch (e: any) {
        console.error(`FAILED: ${e.message}`);
    }
}

// @ts-ignore
const parse = require('parse-ingredient');

// ... (existing imports)

// Mock NUTRIENT_IDS from usda.ts
const NUTRIENT_IDS = {
    ENERGY_KCAL: 1008,
    PROTEIN: 1003,
    FAT: 1004,
    CARBS: 1005,
    FIBER: 1079,
    SUGAR: 2000
};

// Mock unitToGrams
function unitToGrams(unit: string, qty: number): number {
    return 100; // Simplified for test
}

async function simulateNutritionEngine(input: string) {
    console.log(`\n--- SIMULATING ENGINE FOR: "${input}" ---`);
    
    // 1. Parsing Logic (Mirroring nutritionEngine.ts)
    let parsed;
    try {
        const results = parse(input);
        parsed = Array.isArray(results) ? results[0] : results;
    } catch (e) {
        parsed = null;
    }

    if (!parsed || !parsed.description) {
        const regex = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\s+(.*)$/;
        const match = input.match(regex);
        if (match) {
            parsed = {
                quantity: parseFloat(match[1]),
                unitOfMeasure: match[2] || null,
                description: match[3]
            };
            console.log('Regex Fallback Used');
        } else {
            parsed = { description: input, quantity: 1, unitOfMeasure: null };
            console.log('Full String Fallback Used');
        }
    }

    const name = parsed.description || input;
    console.log(`Parsed Name: "${name}"`);

    // 2. USDA Search Logic (Mirroring usda.ts)
    if (!USDA_KEY) { console.log('No USDA Key'); return; }

    try {
        const res = await axios.get('https://api.nal.usda.gov/fdc/v1/foods/search', {
            params: { api_key: USDA_KEY, query: name, pageSize: 1 }
        });
        
        const food = res.data.foods?.[0];
        if (!food) {
            console.log('USDA: No food found.');
            return;
        }

        console.log(`USDA Found: "${food.description}" (ID: ${food.fdcId})`);
        
        const nutrients = food.foodNutrients;
        if (!nutrients) {
            console.log('USDA: No nutrients array.');
            return;
        }

        const getVal = (id: number) => {
            const n = nutrients.find((x: any) => x.nutrientId === id);
            return n ? n.value : 0;
        };

        const stats = {
            calories: getVal(NUTRIENT_IDS.ENERGY_KCAL),
            protein: getVal(NUTRIENT_IDS.PROTEIN),
            fat: getVal(NUTRIENT_IDS.FAT),
            carbs: getVal(NUTRIENT_IDS.CARBS)
        };
        console.log('Extracted Stats:', stats);

    } catch (e: any) {
        console.error('USDA Error:', e.message);
        if (e.response) console.error(JSON.stringify(e.response.data));
    }
}

async function run() {
    await simulateNutritionEngine('1 cup rice');
    await simulateNutritionEngine('200g chicken breast');
}

run();
