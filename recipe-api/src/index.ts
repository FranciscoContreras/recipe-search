import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { supabase } from './supabaseClient';
import { TablesInsert } from './database.types';
import { findNutritionForRecipe } from './services/fatsecret';
import { NutritionEngine } from './services/nutritionEngine';
import { RecipeCrawlerService } from './crawler';
import path from 'path';
import fs from 'fs';
import { injectMetaTags } from './services/seo';
import { apiKeyAuth } from './middleware/auth';
import { requestApiKey } from './controllers/authController';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- SEO & PUBLIC ROUTES (No Auth) ---

// Robots.txt
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /
Sitemap: https://recipe-base.wearemachina.com/sitemap.xml
`);
});

// Sitemap.xml
app.get('/sitemap.xml', async (req, res) => {
  res.type('application/xml');
  res.write('<?xml version="1.0" encoding="UTF-8"?>\n');
  res.write('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n');

  // Static Pages
  const staticPages = ['', '/recipes', '/lab', '/docs'];
  staticPages.forEach(page => {
    res.write(`  <url><loc>https://recipe-base.wearemachina.com${page}</loc><changefreq>daily</changefreq></url>\n`);
  });

  // Dynamic Recipes (Stream from DB)
  // Fetch in chunks to avoid memory issues if DB is huge, but for now standard pagination is fine
  const limit = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: recipes, error } = await supabase
      .from('recipes')
      .select('id, updated_at')
      .neq('qa_status', 'quarantined')
      .range(offset, offset + limit - 1);

    if (error || !recipes || recipes.length === 0) {
      hasMore = false;
    } else {
      recipes.forEach(r => {
        const date = r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString();
        res.write(`  <url><loc>https://recipe-base.wearemachina.com/recipe/${r.id}</loc><lastmod>${date}</lastmod></url>\n`);
      });
      offset += limit;
      if (recipes.length < limit) hasMore = false;
    }
  }

  res.write('</urlset>');
  res.end();
});

// SEO-Optimized Recipe Details (SSR Injection)
app.get('/recipe/:id', async (req, res) => {
  const { id } = req.params;
  
  // 1. Fetch Data
  const { data: recipe, error } = await supabase.from('recipes').select('*').eq('id', id).single();
  
  if (error || !recipe) {
      return res.status(404).sendFile(path.join(__dirname, '../public/index.html')); // Fallback or 404 page
  }

  // 2. Read Template
  const templatePath = path.join(__dirname, '../public/recipe-details.html');
  fs.readFile(templatePath, 'utf8', (err, html) => {
      if (err) return res.status(500).send('Server Error');

      // 3. Inject Meta & Schema
      const finalHtml = injectMetaTags(html, recipe);
      
      res.send(finalHtml);
  });
});

app.use(express.static(path.join(__dirname, '../public')));

// Public Endpoints (No Auth Required)
app.get('/', (req: Request, res: Response) => {
  if (req.accepts('html')) {
     res.sendFile(path.join(__dirname, '../public/index.html'));
     return;
  }
  res.send('Recipe API is running!');
});

app.post('/auth/request-key', requestApiKey);

app.get('/health', async (req: Request, res: Response) => {
  try {
    const { count: total } = await supabase.from('recipes').select('*', { count: 'exact', head: true });
    const { count: verified } = await supabase.from('recipes').select('*', { count: 'exact', head: true }).eq('qa_status', 'verified');
    const { count: flagged } = await supabase.from('recipes').select('*', { count: 'exact', head: true }).eq('qa_status', 'flagged');
    const { data: sample } = await supabase.from('recipes').select('quality_score').not('quality_score', 'is', null).limit(100);
    const avg_score = sample && sample.length > 0 ? sample.reduce((a, b) => a + (b.quality_score || 0), 0) / sample.length : 0;
    const { data: recent } = await supabase.from('recipes').select('id, name, qa_status, quality_score, audit_log').not('last_audited_at', 'is', null).order('last_audited_at', { ascending: false }).limit(10);
    res.json({ stats: { total: total || 0, verified: verified || 0, flagged: flagged || 0, avg_score: avg_score }, recent: recent || [] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// --- PROTECTED ROUTES ---
// All routes below this line require x-api-key header
app.use(apiKeyAuth);

// --- RECIPES ENDPOINTS ---

app.post('/recipes', async (req: Request, res: Response) => {
  const newRecipe: TablesInsert<'recipes'> = req.body;
  if (!newRecipe.name) {
    return res.status(400).json({ error: 'Recipe name is required.' });
  }

  const { data, error } = await supabase.from('recipes').insert([newRecipe]).select();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

app.get('/recipes', async (req: Request, res: Response) => {
  const isFull = req.query.full === 'true';
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = (page - 1) * limit;

  const selectFields = isFull ? '*' : 'id, name, image, description, cook_time, prep_time';
  const { data, error, count } = await supabase
    .from('recipes')
    .select(selectFields, { count: 'exact' })
    .neq('qa_status', 'quarantined')
    .range(offset, offset + limit - 1);

  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ recipes: data, count, page, limit });
});

app.get('/recipes/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  let { data: recipe, error } = await supabase.from('recipes').select('*').eq('id', id).neq('qa_status', 'quarantined').single();
  if (error || !recipe) return res.status(404).json({ error: 'Recipe not found' });

  if (!recipe.nutrition) {
      console.log(`[JIT] Enriching recipe ${id} (${recipe.name})...`);
      const start = Date.now();
      
      // Fire-and-forget: Start enrichment in background but don't block response
      findNutritionForRecipe(recipe.name)
        .then(async (nutrition) => {
            if (nutrition) {
                await supabase.from('recipes').update({ nutrition }).eq('id', id);
                console.log(`[JIT] Success for ${id} in ${Date.now() - start}ms`);
            } else {
                console.log(`[JIT] No nutrition found for ${id} in ${Date.now() - start}ms`);
            }
        })
        .catch((err) => {
            console.error(`[JIT] Error for ${id} in ${Date.now() - start}ms:`, err);
        });
  }
  res.status(200).json(recipe);
});

app.post('/recipes/enrich', async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'Invalid payload.' });
  if (ids.length > 50) return res.status(400).json({ error: 'Batch limit exceeded.' });

  const { data: recipes, error } = await supabase.from('recipes').select('*').in('id', ids).neq('qa_status', 'quarantined');
  if (error) return res.status(500).json({ error: error.message });

  const updates: any[] = [];
  
  const enrichedRecipes = await Promise.all(recipes.map(async (recipe) => {
      if (!recipe.nutrition) {
          try {
              const nutrition = await findNutritionForRecipe(recipe.name);
              if (nutrition) {
                  updates.push({ id: recipe.id, nutrition });
                  return { ...recipe, nutrition };
              }
          } catch (e) { console.error(`Batch fail: ${recipe.id}`, e); }
      }
      return recipe;
  }));

  if (updates.length > 0) {
      const { error: updateError } = await supabase.rpc('update_recipe_nutritions', { payload: updates });
      if (updateError) console.error('Batch update error:', updateError);
  }

  res.status(200).json({ recipes: enrichedRecipes, count: enrichedRecipes.length });
});

app.get('/nutrition/analyze', (req: Request, res: Response) => {
    res.status(405).send('<h1>Method Not Allowed</h1><p>Use POST.</p>');
});

app.post('/nutrition/analyze', async (req: Request, res: Response) => {
  console.log(`DEBUG: HIT /nutrition/analyze POST Endpoint - ${new Date().toISOString()}`);
  const { ingredients } = req.body;
  if (!ingredients || !Array.isArray(ingredients)) return res.status(400).json({ error: 'Invalid payload.' });

  try {
    const result = await NutritionEngine.analyze(ingredients);
    res.json(result);
  } catch (e: any) {
    console.error('Analysis error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/search', async (req: Request, res: Response) => {
  const query = (req.query.q as string) || '';
  const ingredientsParam = req.query.ingredients as string;
  const matchAll = req.query.match_all === 'true';
  const isFull = req.query.full === 'true';
  const ingredients = ingredientsParam ? ingredientsParam.split(',').map(i => i.trim()) : undefined;

  if (!query && !ingredients) {
    const selectFields = isFull ? '*' : 'id, name, image, description, cook_time, prep_time';
    const { data, count, error } = await supabase.from('recipes').select(selectFields, { count: 'exact' }).neq('qa_status', 'quarantined').limit(50);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ recipes: data, count });
  }

  // @ts-ignore
  const { data, error } = await supabase.rpc('search_recipes_hybrid', { search_term: query, filter_ingredients: ingredients, match_all_ingredients: matchAll });
  if (error) return res.status(500).json({ error: error.message });

  const finalData = isFull ? data : (data || []).map((r: any) => ({ id: r.id, name: r.name, image: r.image, description: r.description, cook_time: r.cook_time, prep_time: r.prep_time }));
  res.status(200).json({ recipes: finalData, count: (data || []).length });
});

app.post('/crawl', async (req: Request, res: Response) => {
  let { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required.' });
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const { data, error } = await supabase.from('crawl_jobs').insert([{ url, status: 'pending' }]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ message: 'Crawl queued', job: data });
});

app.get('/jobs', async (req: Request, res: Response) => {
  const { data, error } = await supabase.from('crawl_jobs').select('*').eq('is_archived', false).order('created_at', { ascending: false }).limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json(data);
});

app.get('/jobs/archived', async (req: Request, res: Response) => {
  const { data, error } = await supabase.from('crawl_jobs').select('*').eq('is_archived', true).order('updated_at', { ascending: false }).limit(5);
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json(data);
});

app.get('/jobs/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('crawl_jobs').select('*').eq('id', id).single();
  if (error) return res.status(404).json({ error: 'Job not found' });
  res.status(200).json(data);
});

app.delete('/jobs/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { error } = await supabase.from('crawl_jobs').update({ is_archived: true, status: 'failed', log: 'Archived/Stopped by user', updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ message: 'Job archived.' });
});

app.delete('/jobs', async (req: Request, res: Response) => {
  const { error } = await supabase.from('crawl_jobs').update({ is_archived: true, status: 'failed', log: 'Archived/Stopped by user', updated_at: new Date().toISOString() }).eq('is_archived', false);
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ message: 'All jobs archived.' });
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
