import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { supabase } from './supabaseClient';
import { TablesInsert } from './database.types';
import { NutritionEngine } from './services/nutritionEngine';
import { RecipeCrawlerService } from './crawler';
import path from 'path';
import fs from 'fs';
import { injectMetaTags } from './services/seo';
import { apiKeyAuth } from './middleware/auth';
import { requestApiKey } from './controllers/authController';
import { lookupBarcode } from './services/openFoodFacts';
import { isSafePublicUrl } from './utils/url';
import { inferDishContext, resolveContext, DISH_CONTEXT_DESCRIPTIONS, DishContext } from './utils/cookingState';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import { swaggerOptions } from './swaggerOptions';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const port = process.env.PORT || 3000;

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for now to avoid breaking inline scripts/styles in existing HTML
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 300 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: 'Too many requests from this IP, please try again later.'
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Limit each IP to 5 key requests per hour
  message: 'Too many key requests from this IP, please try again later.'
});

app.use(limiter); // Apply global limiter
app.use(cors());
app.use(express.json());

const specs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, { customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui.min.css' }));

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
      .neq('qa_status', 'rejected')
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

app.post('/auth/request-key', authLimiter, requestApiKey);

// Refresh the recipe_stats materialized view — called on a schedule and after bulk operations
async function refreshRecipeStats() {
  try {
    await supabase.rpc('refresh_materialized_view_stats');
  } catch { /* non-critical — view will serve cached data */ }
}

// Refresh stats every 5 minutes
setInterval(refreshRecipeStats, 5 * 60 * 1000);

app.get('/health', async (req: Request, res: Response) => {
  try {
    // Read from the materialized view (single row, pre-computed) — no table scans
    const { data: stats } = await supabase
      .from('recipe_stats')
      .select('total, verified, flagged, quarantined, pending, avg_quality_score, computed_at')
      .single();

    const { data: recent } = await supabase
      .from('recipes')
      .select('id, name, qa_status, quality_score, audit_log')
      .not('last_audited_at', 'is', null)
      .order('last_audited_at', { ascending: false })
      .limit(10);

    const s = stats || { total: 0, verified: 0, flagged: 0, avg_quality_score: 0 };
    res.json({
      stats: {
        total:     s.total     || 0,
        verified:  s.verified  || 0,
        flagged:   s.flagged   || 0,
        avg_score: parseFloat(s.avg_quality_score as any) || 0,
      },
      recent: recent || [],
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// --- PROTECTED ROUTES ---
// All routes below this line require x-api-key header
app.use(apiKeyAuth);

// --- RECIPES ENDPOINTS ---

/**
 * @swagger
 * /recipes:
 *   post:
 *     summary: Create a new recipe
 *     tags: [Recipes]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Recipe'
 *     responses:
 *       201:
 *         description: The recipe was successfully created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Recipe'
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Server error
 */
app.post('/recipes', async (req: Request, res: Response) => {
  const newRecipe: TablesInsert<'recipes'> = req.body;
  if (!newRecipe.name) {
    return res.status(400).json({ error: 'Recipe name is required.' });
  }

  const { data, error } = await supabase.from('recipes').insert([newRecipe]).select();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

/**
 * @swagger
 * /recipes:
 *   get:
 *     summary: Returns a list of recipes
 *     tags: [Recipes]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: The page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: The number of items per page
 *       - in: query
 *         name: full
 *         schema:
 *           type: boolean
 *         description: If true, returns full recipe details. If false (default), returns metadata only.
 *     responses:
 *       200:
 *         description: The list of recipes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 recipes:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Recipe'
 *                 count:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 */
app.get('/recipes', async (req: Request, res: Response) => {
  console.log(`[GET] /recipes - Page: ${req.query.page}, Limit: ${req.query.limit} - ${new Date().toISOString()}`);
  const isFull = req.query.full === 'true';
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = (page - 1) * limit;

  const selectFields = isFull ? '*' : 'id, name, image, description, cook_time, prep_time';
  const { data, error, count } = await supabase
    .from('recipes')
    .select(selectFields, { count: 'exact' })
    .neq('qa_status', 'quarantined')
    .neq('qa_status', 'rejected')
    .range(offset, offset + limit - 1);

  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ recipes: data, count, page, limit });
});

/**
 * @swagger
 * /recipes/{id}:
 *   get:
 *     summary: Get a recipe by ID
 *     tags: [Recipes]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The recipe ID
 *     responses:
 *       200:
 *         description: The recipe description by id
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Recipe'
 *       404:
 *         description: The recipe was not found
 */
app.get('/recipes/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  let { data: recipe, error } = await supabase.from('recipes').select('*').eq('id', id).neq('qa_status', 'quarantined').neq('qa_status', 'rejected').single();
  if (error || !recipe) return res.status(404).json({ error: 'Recipe not found' });

  if (!recipe.nutrition && Array.isArray(recipe.recipe_ingredients) && recipe.recipe_ingredients.length > 0) {
      const start = Date.now();
      // Fire-and-forget: enrich in background without blocking the response
      NutritionEngine.analyzeRecipe(recipe.name, recipe.recipe_ingredients)
        .then(async (result) => {
            const nutrition = { ...result.total, dishContext: result.dishContext, source: result.source, analyzedAt: result.analyzedAt };
            await supabase.from('recipes').update({ nutrition }).eq('id', id);
            console.log(`[JIT] Enriched ${id} (${result.dishContext}) in ${Date.now() - start}ms`);
        })
        .catch((err) => console.error(`[JIT] Error for ${id}:`, err));
  }
  res.status(200).json(recipe);
});

app.post('/recipes/enrich', async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'Invalid payload.' });
  if (ids.length > 50) return res.status(400).json({ error: 'Batch limit exceeded.' });

  const { data: recipes, error } = await supabase.from('recipes').select('*').in('id', ids).neq('qa_status', 'quarantined').neq('qa_status', 'rejected');
  if (error) return res.status(500).json({ error: error.message });

  const updates: any[] = [];
  
  const enrichedRecipes = await Promise.all(recipes.map(async (recipe) => {
      if (!recipe.nutrition && Array.isArray(recipe.recipe_ingredients) && recipe.recipe_ingredients.length > 0) {
          try {
              const result = await NutritionEngine.analyzeRecipe(recipe.name, recipe.recipe_ingredients);
              const nutrition = { ...result.total, dishContext: result.dishContext, source: result.source, analyzedAt: result.analyzedAt };
              updates.push({ id: recipe.id, nutrition });
              return { ...recipe, nutrition };
          } catch (e) { console.error(`Batch enrichment failed for ${recipe.id}:`, e); }
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

/**
 * Infer the dish context for a recipe name without running a full analysis.
 * Useful for any product layer that needs to know what cooking assumptions
 * the engine will make before committing to an analysis call.
 *
 * POST /nutrition/infer-context
 * Body: { "recipeName": "Moroccan Chickpea Stew" }
 * Returns: { "dishContext": "simmered", "description": "...", "grainState": "raw" }
 */
app.post('/nutrition/infer-context', (req: Request, res: Response) => {
  const { recipeName } = req.body;
  if (!recipeName || typeof recipeName !== 'string') {
      return res.status(400).json({ error: 'recipeName is required.' });
  }
  const { context, inferred } = resolveContext(null, recipeName);
  return res.json({
      dishContext:  context,
      description:  DISH_CONTEXT_DESCRIPTIONS[context],
      grainState:   context === 'assembled' || context === 'stir-fry' ? 'cooked' : 'raw',
      autoDetected: inferred,
  });
});

/**
 * @swagger
 * /nutrition/barcode:
 *   post:
 *     summary: Look up nutrition by product barcode (EAN-13 / UPC-A)
 *     tags: [Nutrition]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [barcode]
 *             properties:
 *               barcode:
 *                 type: string
 *                 example: "5449000214911"
 *               amount_g:
 *                 type: number
 *                 description: Optional serving weight in grams (defaults to 100g)
 *                 example: 330
 *     responses:
 *       200:
 *         description: Product nutrition data
 *       404:
 *         description: Barcode not found in Open Food Facts
 */
app.post('/nutrition/barcode', async (req: Request, res: Response) => {
    const { barcode, amount_g } = req.body;
    if (!barcode || typeof barcode !== 'string') {
        return res.status(400).json({ error: 'barcode is required.' });
    }
    if (!/^\d{8,14}$/.test(barcode.trim())) {
        return res.status(400).json({ error: 'barcode must be 8-14 digits (EAN-8, EAN-13, UPC-A).' });
    }

    const result = await lookupBarcode(barcode.trim());
    if (!result) {
        return res.status(404).json({ error: 'Product not found in Open Food Facts database.' });
    }

    const grams = typeof amount_g === 'number' && amount_g > 0 ? amount_g : 100;
    const ratio = grams / 100;
    const { nutrition, ...meta } = result;

    return res.json({
        ...meta,
        amount_g: grams,
        nutrition: {
            calories:      Math.round(nutrition.calories      * ratio),
            protein:       parseFloat((nutrition.protein      * ratio).toFixed(1)),
            fat:           parseFloat((nutrition.fat          * ratio).toFixed(1)),
            carbs:         parseFloat((nutrition.carbs        * ratio).toFixed(1)),
            fiber:         parseFloat((nutrition.fiber        * ratio).toFixed(1)),
            sugar:         parseFloat((nutrition.sugar        * ratio).toFixed(1)),
            calcium_mg:    Math.round(nutrition.calcium_mg    * ratio),
            iron_mg:       parseFloat((nutrition.iron_mg      * ratio).toFixed(2)),
            vitamin_c_mg:  parseFloat((nutrition.vitamin_c_mg * ratio).toFixed(1)),
        },
        per_100g: {
            calories: Math.round(nutrition.calories),
            protein:  parseFloat(nutrition.protein.toFixed(1)),
            fat:      parseFloat(nutrition.fat.toFixed(1)),
            carbs:    parseFloat(nutrition.carbs.toFixed(1)),
        },
        source: 'Open Food Facts',
    });
});

/**
 * @swagger
 * /nutrition/analyze:
 *   post:
 *     summary: Analyze ingredients for nutritional data
 *     tags: [Nutrition]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ingredients
 *             properties:
 *               ingredients:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["1 cup rice", "200g chicken"]
 *     responses:
 *       200:
 *         description: Nutritional analysis result
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NutritionAnalysis'
 */
app.post('/nutrition/analyze', async (req: Request, res: Response) => {
  const { ingredients, dishContext, recipeName } = req.body;
  if (!ingredients || !Array.isArray(ingredients)) return res.status(400).json({ error: 'ingredients must be an array of strings.' });
  if (ingredients.length === 0) return res.status(400).json({ error: 'ingredients array cannot be empty.' });
  if (ingredients.length > 50) return res.status(400).json({ error: 'Maximum 50 ingredients per request.' });
  if (ingredients.some((i: unknown) => typeof i !== 'string')) return res.status(400).json({ error: 'All ingredients must be strings.' });
  if (ingredients.some((i: string) => i.length > 500)) return res.status(400).json({ error: 'Ingredient string too long (max 500 chars).' });

  const { context: ctx, inferred } = resolveContext(dishContext, recipeName);

  try {
    const result = await NutritionEngine.analyze(ingredients, ctx);
    res.json({ ...result, dishContext: ctx, ...(inferred ? { inferredFrom: recipeName } : {}) });
  } catch (e: any) {
    console.error('Analysis error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * Inspect cooking state for a list of ingredients.
 * Returns detectedState ('raw' | 'cooked' | 'ambiguous') and calorie estimates
 * for both cooked and raw versions when the state is ambiguous.
 * Useful for auditing recipe ingredient lists and understanding calorie differences.
 */
app.post('/nutrition/cooking-states', async (req: Request, res: Response) => {
  const { ingredients, recipeName } = req.body;
  if (!ingredients || !Array.isArray(ingredients)) return res.status(400).json({ error: 'ingredients must be an array of strings.' });
  if (ingredients.length === 0)  return res.status(400).json({ error: 'ingredients array cannot be empty.' });
  if (ingredients.length > 20)   return res.status(400).json({ error: 'Maximum 20 ingredients per request.' });
  if (ingredients.some((i: unknown) => typeof i !== 'string')) return res.status(400).json({ error: 'All ingredients must be strings.' });

  const { context: detectedContext } = resolveContext(null, recipeName);

  try {
    const [asRaw, asCooked] = await Promise.all([
      NutritionEngine.analyze(ingredients, 'standard'),
      NutritionEngine.analyze(ingredients, 'assembled'),
    ]);

    const result = asRaw.breakdown.map((rawItem: any, i: number) => {
      const cookedItem = asCooked.breakdown[i];
      const detectedState: string = rawItem.cookingState ?? 'raw';
      const isAmbiguous = detectedState === 'ambiguous' ||
        (rawItem.stats && cookedItem.stats &&
         Math.abs(rawItem.stats.calories - cookedItem.stats.calories) > 30);

      const entry: any = {
        original:      rawItem.ingredient,
        name:          rawItem.parsed?.name ?? rawItem.ingredient,
        detectedState,
      };

      if (rawItem.status === 'not_found') {
        entry.status = 'not_found';
        return entry;
      }

      entry.raw = {
        weightG:  rawItem.parsed?.weightGrams ?? null,
        calories: Math.round(rawItem.stats?.calories ?? 0),
      };
      entry.cooked = {
        weightG:  cookedItem.parsed?.weightGrams ?? null,
        calories: Math.round(cookedItem.stats?.calories ?? 0),
      };

      if (isAmbiguous) {
        const contextHint = detectedContext !== 'standard'
          ? `Detected dish context: "${detectedContext}". `
          : '';
        entry.warning =
          `${contextHint}Ambiguous cooking state — ` +
          `raw ≈ ${entry.raw.calories} kcal vs cooked ≈ ${entry.cooked.calories} kcal. ` +
          `Pass dishContext ("standard"|"assembled"|"simmered"|"stir-fry"|"baked") or ` +
          `recipeName to /nutrition/analyze for automatic inference.`;
      }

      // Attach the recommended calories based on detected context
      if (isAmbiguous && detectedContext !== 'standard') {
        const grainState = resolveCookingState('ambiguous', detectedContext);
        entry.recommended = grainState === 'cooked' ? entry.cooked : entry.raw;
      } else {
        entry.recommended = entry.raw;
      }

      return entry;
    });

    res.json({
      ingredients: result,
      detectedContext,
      ...(recipeName ? { recipeName } : {}),
    });
  } catch (e: any) {
    console.error('Cooking states error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * @swagger
 * /search:
 *   get:
 *     summary: Search recipes by keyword or ingredients
 *     tags: [Search]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Fuzzy search term (e.g. "pasta")
 *       - in: query
 *         name: ingredients
 *         schema:
 *           type: string
 *         description: Comma-separated list of ingredients to filter by (e.g. "chicken, rice")
 *       - in: query
 *         name: match_all
 *         schema:
 *           type: boolean
 *         description: If true, returns recipes containing ALL specified ingredients.
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 recipes:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Recipe'
 *                 count:
 *                   type: integer
 */
app.get('/search', async (req: Request, res: Response) => {
  const query = (req.query.q as string) || '';
  const ingredientsParam = req.query.ingredients as string;
  const matchAll = req.query.match_all === 'true';
  const isFull = req.query.full === 'true';
  const ingredients = ingredientsParam ? ingredientsParam.split(',').map(i => i.trim()) : undefined;

  if (!query && !ingredients) {
    const selectFields = isFull ? '*' : 'id, name, image, description, cook_time, prep_time';
    const { data, count, error } = await supabase.from('recipes').select(selectFields, { count: 'exact' }).neq('qa_status', 'quarantined').neq('qa_status', 'rejected').limit(50);
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
  if (!isSafePublicUrl(url)) return res.status(400).json({ error: 'URL must point to a public host.' });
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
