import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const CLIENT_ID = process.env.FATSECRET_CLIENT_ID;
const CLIENT_SECRET = process.env.FATSECRET_CLIENT_SECRET;

async function testFatSecret() {
    console.log('--- TESTING FATSECRET DATA ---');
    
    if (!CLIENT_ID || !CLIENT_SECRET) {
        console.error('Missing Credentials');
        return;
    }

    // 1. Auth
    const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://oauth.fatsecret.com/connect/token', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials&scope=basic'
    });
    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;

    // 2. Search
    const term = 'banana';
    const searchRes = await fetch('https://platform.fatsecret.com/rest/server.api', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: new URLSearchParams({ method: 'foods.search', search_expression: term, format: 'json', max_results: '1' })
    });
    const searchData = await searchRes.json();
    console.log('Search Response:', JSON.stringify(searchData, null, 2)); // Debug full response
    const foods = searchData.foods?.food;
    const foodItem = Array.isArray(foods) ? foods[0] : foods;
    const foodId = foodItem?.food_id;

    if (!foodId) {
        console.log('No food found');
        return;
    }

    // 3. Get Details
    console.log(`Getting details for Food ID: ${foodId}`);
    const detailsRes = await fetch('https://platform.fatsecret.com/rest/server.api', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: new URLSearchParams({ method: 'food.get.v2', food_id: foodId, format: 'json' })
    });
    const details = await detailsRes.json();
    const serving = details.food?.servings?.serving?.[0] || details.food?.servings?.serving;

    console.log('\n--- SERVING DATA ---');
    console.log('Metric Unit:', serving.metric_serving_unit);
    console.log('Metric Amount:', serving.metric_serving_amount);
    console.log('Calories:', serving.calories);
    console.log('Calcium:', serving.calcium);
    console.log('Iron:', serving.iron);
    console.log('Vit A:', serving.vitamin_a);
    console.log('Vit C:', serving.vitamin_c);
    console.log('--------------------');
}

testFatSecret();
