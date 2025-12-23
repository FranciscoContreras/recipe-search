import { supabase } from '../supabaseClient';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function checkCache() {
    const term = 'v3:orange';
    console.log(`Checking cache for "${term}"...`);
    
    const { data, error } = await supabase
        .from('ingredient_cache')
        .select('*')
        .eq('term', term);
// ...

    if (error) {
        console.error('Error:', error);
    } else {
        if (data.length === 0) {
            console.log('No cache entry found.');
        } else {
            console.log('Cache Entry:', JSON.stringify(data[0].nutrition, null, 2));
        }
    }
}

checkCache();
