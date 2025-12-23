import { supabase } from '../supabaseClient';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function clearCache() {
    console.log('--- CACHE CLEAR DEBUG ---');
    
    const { count: before } = await supabase.from('ingredient_cache').select('*', { count: 'exact', head: true });
    console.log(`Rows BEFORE: ${before}`);

    const { error, count } = await supabase
        .from('ingredient_cache')
        .delete()
        .neq('term', '_____'); 

    if (error) {
        console.error('Error clearing cache:', error);
    } else {
        console.log(`Delete command executed.`);
    }

    const { count: after } = await supabase.from('ingredient_cache').select('*', { count: 'exact', head: true });
    console.log(`Rows AFTER: ${after}`);
}

clearCache();
