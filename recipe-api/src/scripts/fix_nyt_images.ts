import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { supabase } from '../supabaseClient';

async function fixNytImages() {
  console.log('Starting NYT Image Fixer Worker...');
  
  let totalFixed = 0;
  let hasMore = true;
  const BATCH_SIZE = 50;

  while (hasMore) {
    // Fetch recipes where image starts with '{' (indicating a JSON object instead of a URL)
    const { data: recipes, error } = await supabase
      .from('recipes')
      .select('id, image, name')
      .like('image', '{%')
      .range(0, BATCH_SIZE - 1);

    if (error) {
      console.error('Error fetching recipes:', error.message);
      break;
    }

    if (!recipes || recipes.length === 0) {
      console.log('No more malformed images found.');
      hasMore = false;
      break;
    }

    console.log(`Processing batch of ${recipes.length} recipes...`);
    let batchFixed = 0;

    for (const recipe of recipes) {
      try {
        if (typeof recipe.image === 'string' && recipe.image.trim().startsWith('{')) {
            const parsed = JSON.parse(recipe.image);
            // NYT often uses 'url', sometimes 'contentUrl'
            let cleanUrl = parsed.url || parsed.contentUrl;
            
            // Sometimes it's nested in an array in the object? (Unlikely for the specific stringified case seen, but being safe)
            // The example was {"@id":..., "url": "..."}
            
            if (cleanUrl) {
                const { error: updateError } = await supabase
                    .from('recipes')
                    .update({ image: cleanUrl })
                    .eq('id', recipe.id);
                
                if (updateError) {
                    console.error(`Failed to update ${recipe.id}:`, updateError.message);
                } else {
                    // console.log(`Fixed: ${recipe.name ? recipe.name.substring(0, 30) : recipe.id}...`);
                    batchFixed++;
                    totalFixed++;
                }
            } else {
                console.warn(`Could not extract URL for recipe ${recipe.id}. JSON: ${recipe.image.substring(0, 50)}...`);
                // If we can't fix it, we must ensure we don't fetch it again in the loop or we'll infinite loop.
                // We'll set it to null or a placeholder to dequeue it from the 'like {%'' filter.
                await supabase.from('recipes').update({ image: null }).eq('id', recipe.id);
            }
        } else {
            // Should not happen due to filter, but if it does:
             console.log(`Skipping non-JSON image: ${recipe.id}`);
        }
      } catch (e: any) {
        console.error(`Failed to parse/fix ${recipe.id}:`, e.message);
         // Prevent infinite loop on unparseable data
         await supabase.from('recipes').update({ image: null }).eq('id', recipe.id);
      }
    }
    
    console.log(`Batch complete. Fixed: ${batchFixed}. Total Fixed so far: ${totalFixed}`);
    
    // Slight delay to be nice to the DB
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('-----------------------------------');
  console.log(`Job Finished. Total recipes fixed: ${totalFixed}`);
  process.exit(0);
}

fixNytImages().catch(e => {
    console.error('Fatal Error:', e);
    process.exit(1);
});
