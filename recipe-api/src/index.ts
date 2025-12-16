import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { supabase } from './supabaseClient';
import { TablesInsert } from './database.types';
import { findNutritionForRecipe } from './services/fatsecret';
import { NutritionEngine } from './services/nutritionEngine';
import { RecipeCrawlerService } from './crawler';
import path from 'path';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req: Request, res: Response) => {
  if (req.accepts('html')) {
     res.sendFile(path.join(__dirname, '../public/index.html'));
     return;
  }
  res.send('Recipe API is running!');
});

// --- RECIPES ENDPOINTS ---

app.post('/recipes', async (req: Request, res: Response) => {
  const newRecipe: TablesInsert<'recipes'> = req.body;
  if (!newRecipe.name) {
    return res.status(400).json({ error: 'Recipe name is required.' });
  }

  const { data, error } = await supabase
    .from('recipes')
    .insert([newRecipe])
    .select();

  if (error) {
    console.error('Error inserting new recipe:', error);
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

app.get('/recipes', async (req: Request, res: Response) => {
  const isFull = req.query.full === 'true';
  const selectFields = isFull 
    ? '*' 
    : 'id, name, image, description, cook_time, prep_time';

  const { data, error, count } = await supabase
    .from('recipes')
    .select(selectFields, { count: 'exact' })
    .neq('qa_status', 'quarantined');
    
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.status(200).json({ recipes: data, count });
});

app.get('/recipes/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  let { data: recipe, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('id', id)
    .neq('qa_status', 'quarantined') 
    .single();
  
  if (error || !recipe) {
    return res.status(404).json({ error: 'Recipe not found' });
  }

  // JIT Nutrition Enrichment
  if (!recipe.nutrition) {
      console.log(`JIT Enrichment: Fetching nutrition for ${recipe.name}`);
      try {
          const nutrition = await findNutritionForRecipe(recipe.name);
          if (nutrition) {
              await supabase.from('recipes').update({ nutrition }).eq('id', id);
              recipe.nutrition = nutrition; 
          }
      } catch (err) {
          console.error('JIT Nutrition failed:', err);
      }
  }

  res.status(200).json(recipe);
});

// POST /recipes/enrich - Batch retrieve and enrich recipes
app.post('/recipes/enrich', async (req: Request, res: Response) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ error: 'Invalid payload: "ids" must be an array of UUIDs.' });
  }

  if (ids.length > 50) {
      return res.status(400).json({ error: 'Batch size limit exceeded (max 50).' });
  }

  const { data: recipes, error } = await supabase
    .from('recipes')
    .select('*')
    .in('id', ids)
    .neq('qa_status', 'quarantined');

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Process enrichment in parallel
  const enrichedRecipes = await Promise.all(recipes.map(async (recipe) => {
      if (!recipe.nutrition) {
          try {
              const nutrition = await findNutritionForRecipe(recipe.name);
              if (nutrition) {
                  supabase.from('recipes').update({ nutrition }).eq('id', recipe.id).then();
                  return { ...recipe, nutrition };
              }
          } catch (e) {
              console.error(`Batch Enrichment failed for ${recipe.id}`, e);
          }
      }
      return recipe;
  }));

  res.status(200).json({ recipes: enrichedRecipes, count: enrichedRecipes.length });
});

// --- NUTRITION ANALYSIS ENDPOINT ---
app.post('/nutrition/analyze', async (req: Request, res: Response) => {
  const { ingredients } = req.body;

  if (!ingredients || !Array.isArray(ingredients)) {
    return res.status(400).json({ error: 'Invalid payload: "ingredients" must be an array of strings.' });
  }

  try {
    const result = await NutritionEngine.analyze(ingredients);
    res.json(result);
  } catch (e: any) {
    console.error('Analysis error:', e);
    res.status(500).json({ error: e.message });
  }
});

// --- SEARCH ENDPOINT ---
app.get('/search', async (req: Request, res: Response) => {
  const query = (req.query.q as string) || '';
  const ingredientsParam = req.query.ingredients as string;
  const matchAllParam = req.query.match_all as string;
  const isFull = req.query.full === 'true';

  const ingredients = ingredientsParam ? ingredientsParam.split(',').map(i => i.trim()) : undefined;
  const matchAll = matchAllParam === 'true';

  if (!query && !ingredients) {
    const selectFields = isFull 
        ? '*' 
        : 'id, name, image, description, cook_time, prep_time';

    const { data, count, error } = await supabase
        .from('recipes')
        .select(selectFields, { count: 'exact' })
        .neq('qa_status', 'quarantined')
        .limit(50);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ recipes: data, count });
  }

  // @ts-ignore
  const { data, error } = await supabase.rpc('search_recipes_hybrid', { 
      search_term: query,
      filter_ingredients: ingredients,
      match_all_ingredients: matchAll
  });

  if (error) {
    console.error('Search error:', error);
    return res.status(500).json({ error: error.message });
  }

  const finalData = isFull ? data : (data || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      image: r.image,
      description: r.description,
      cook_time: r.cook_time,
      prep_time: r.prep_time
  }));

  res.status(200).json({ recipes: finalData, count: (data || []).length });
});

// --- HEALTH ENDPOINT ---
app.get('/health', async (req: Request, res: Response) => {
  try {
    const { count: total } = await supabase.from('recipes').select('*', { count: 'exact', head: true });
    const { count: verified } = await supabase.from('recipes').select('*', { count: 'exact', head: true }).eq('qa_status', 'verified');
    const { count: flagged } = await supabase.from('recipes').select('*', { count: 'exact', head: true }).eq('qa_status', 'flagged');
    
    const { data: sample } = await supabase.from('recipes').select('quality_score').not('quality_score', 'is', null).limit(100);
    const avg_score = sample && sample.length > 0 
        ? sample.reduce((a, b) => a + (b.quality_score || 0), 0) / sample.length 
        : 0;

    const { data: recent } = await supabase
        .from('recipes')
        .select('id, name, qa_status, quality_score, audit_log')
        .not('last_audited_at', 'is', null)
        .order('last_audited_at', { ascending: false })
        .limit(10);

    res.json({
        stats: { total: total || 0, verified: verified || 0, flagged: flagged || 0, avg_score: avg_score },
        recent: recent || []
    });
  } catch (e: any) {
      res.status(500).json({ error: e.message });
  }
});

// --- CRAWLER ENDPOINTS ---

app.post('/crawl', async (req: Request, res: Response) => {
  let { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required.' });
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  // RecipeCrawlerService.setStopAllCrawls(false); // REMOVED (Handled by Worker)

  const { data, error } = await supabase
    .from('crawl_jobs')
    .insert([{ url, status: 'pending' }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ message: 'Crawl queued', job: data });
});

app.get('/jobs', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('crawl_jobs')
    .select('*')
    .eq('is_archived', false)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json(data);
});

app.get('/jobs/archived', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('crawl_jobs')
    .select('*')
    .eq('is_archived', true)
    .order('updated_at', { ascending: false })
    .limit(5);

  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json(data);
});

app.get('/jobs/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('crawl_jobs')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return res.status(404).json({ error: 'Job not found' });
  res.status(200).json(data);
});

app.delete('/jobs/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { error } = await supabase
    .from('crawl_jobs')
    .update({ is_archived: true, status: 'failed', log: 'Archived/Stopped by user', updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ message: 'Job archived.' });
});

app.delete('/jobs', async (req: Request, res: Response) => {
  // Logic: Just archive everything. Worker handles the stop via DB polling or restart.
  // Note: If you want immediate stop without restart, you need the flag, but we removed it from API.
  // We rely on the worker picking up the 'failed' status update if we did that, but here we just archive.
  // Ideally, update status to 'failed' too.
  const { error } = await supabase
    .from('crawl_jobs')
    .update({ is_archived: true, status: 'failed', log: 'Archived/Stopped by user', updated_at: new Date().toISOString() })
    .eq('is_archived', false);

  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ message: 'All jobs archived.' });
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});