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
        const res = await axios.get('https://api.nal.usda.gov/fdc/v1/foods/search', {
            params: { api_key: USDA_KEY, query: 'apple', pageSize: 1 }
        });
        console.log(`Status: ${res.status}`);
        console.log(`Found: ${res.data.foods?.length} items`);
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
        const res = await fetch('https://oauth.fatsecret.com/connect/token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'grant_type=client_credentials&scope=basic'
        });
        
        if (!res.ok) {
            console.error(`Auth FAILED: ${res.status} ${res.statusText}`);
            const txt = await res.text();
            console.error(txt);
            return;
        }
        
        const data = await res.json();
        console.log(`Auth SUCCESS. Token: ${data.access_token.substring(0, 10)}...`);
    } catch (e: any) {
        console.error(`FAILED: ${e.message}`);
    }
}

async function run() {
    await testUsda();
    await testFatSecret();
}

run();
