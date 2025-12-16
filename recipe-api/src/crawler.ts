import { CheerioCrawler, Dataset } from 'crawlee';
import { supabase } from './supabaseClient';
import { Database } from './database.types';
import { calculateScore } from './utils/scoring';
import path from 'path';

type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'blocked' | 'cooling_down';

let shouldStopAllCrawls = false;

// Helper to normalize URLs (strip query params and fragments)
function normalizeUrl(url: string): string {
    try {
        const u = new URL(url);
        u.search = '';
        u.hash = '';
        return u.href.replace(/\/$/, '');
    } catch (e) {
        return url;
    }
}

export class RecipeCrawlerService {
  private jobId: string;
  private startUrl: string;
  private crawler: CheerioCrawler | null = null;
  private isRetry: boolean;

  constructor(jobId: string, startUrl: string, isRetry: boolean = false) {
    this.jobId = jobId;
    this.startUrl = startUrl;
    this.isRetry = isRetry;
  }

  async start() {
    let recipesFound = 0;
    const errors: string[] = [];

    const instanceId = process.env.INSTANCE_ID || 'default';
    const storageDir = path.join(process.cwd(), `storage-${instanceId}`);

    this.crawler = new CheerioCrawler({
      // Gentle & Polite settings
      maxConcurrency: this.isRetry ? 1 : 2,
      maxRequestRetries: this.isRetry ? 5 : 3,
      requestHandlerTimeoutSecs: 60,
      
      // Use a standard browser header
      additionalMimeTypes: ['application/json'], 
      
      // Request Handler
      requestHandler: async ({ request, enqueueLinks, log, $, response }) => {
        // Normalize URL immediately
        const normalizedUrl = normalizeUrl(request.url);

        // 0. Check if job is still valid (live check)
        // Disabling this check temporarily as it seems to be causing race conditions where valid jobs abort immediately.
        // The worker process is the source of truth.
        /*
        const { data: currentJob } = await supabase
            .from('crawl_jobs')
            .select('status, is_archived')
            .eq('id', this.jobId)
            .single();

        if (currentJob && (currentJob.status !== 'processing' || currentJob.is_archived)) {
             log.info(`Job ${this.jobId} was stopped externally (Status: ${currentJob.status}). Aborting...`);
             throw new Error('Crawl stopped by user'); 
        }
        */

        if (shouldStopAllCrawls) {
            log.info(`Stopping crawl for job ${this.jobId} due to global stop signal.`);
            await this.updateJobStatus('failed', recipesFound, `Crawl aborted: ${normalizedUrl}`);
            return; 
        }

        // BLOCKING DETECTION
        const statusCode = response.statusCode;
        if (statusCode === 403 || statusCode === 429) {
            log.warning(`Access denied (Status: ${statusCode}) for ${normalizedUrl}`);
            const retryDelayHours = 24 * (request.retryCount + 1);
            const nextRetry = new Date(Date.now() + retryDelayHours * 60 * 60 * 1000).toISOString();
            await this.updateJobStatus('cooling_down', recipesFound, `Blocked: HTTP ${statusCode} at ${normalizedUrl}. Retrying in ${retryDelayHours} hours.`, nextRetry);
            throw new Error('Crawl blocked, cooling down.');
        }

        const pageTitle = $('title').text();
        const bodyText = $('body').text();
        if (pageTitle.includes('Access Denied') || pageTitle.includes('Just a moment...') || bodyText.includes('Access Denied')) {
             log.warning(`Access denied (Content) for ${normalizedUrl}`);
             const retryDelayHours = 24 * (request.retryCount + 1);
             const nextRetry = new Date(Date.now() + retryDelayHours * 60 * 60 * 1000).toISOString();
             await this.updateJobStatus('cooling_down', recipesFound, `Blocked: Anti-bot page at ${normalizedUrl}. Retrying in ${retryDelayHours} hours.`, nextRetry);
             throw new Error('Crawl blocked, cooling down.');
        }

        let foundInPage = 0;

        // Random gentle delay
        const delay = Math.floor(Math.random() * 2000) + 1000;
        await new Promise(r => setTimeout(r, delay));
        
        if (this.isRetry) {
             await new Promise(r => setTimeout(r, 5000));
        }

        log.info(`Processing ${normalizedUrl} ...`);

        // 1. Aggressively enqueue links
        await enqueueLinks({
          strategy: 'same-hostname',
          exclude: ['**/about', '**/contact', '**/privacy-policy', '**/login', '**/cart'],
        });

        // 2. Specific targeting
        await enqueueLinks({
          strategy: 'same-hostname',
          globs: [
            '**/recipe/**',
            '**/*recipe*', 
            'https://www.recipetineats.com/*/', 
            'https://www.recipetineats.com/*/*/'
          ],
          selector: 'a.entry-title-link, .entry-title a, article a, .post-summary a, .pagination a',
          label: 'RECIPE_OR_PAGINATION'
        });

        // 3. Extract Schema.org data
        let schemaData: any[] = [];
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const content = $(el).html();
                if (content) {
                    const parsed = JSON.parse(content);
                    schemaData.push(parsed);
                }
            } catch (e) {
                // ignore parse errors
            }
        });

        // Helper to scrape from DOM
        const scrapeFromDom = () => {
            const getText = (sel: string) => $(sel).first().text().trim() || null;
            const getList = (sel: string) => {
                return $(sel).map((_, el) => $(el).text().trim()).get().filter(Boolean);
            };

            return {
                name: getText('.wprm-recipe-name, .entry-title, h1'),
                description: getText('.wprm-recipe-summary, .entry-content p'),
                recipe_ingredients: getList('.wprm-recipe-ingredient, .wprm-recipe-ingredient-name, li.ingredient'),
                recipe_instructions: getList('.wprm-recipe-instruction-text, .wprm-recipe-instruction, .instructions li'),
                image: $('.wprm-recipe-image img, .wprm-recipe-image-container img, .entry-content img').first().attr('src') || null
            };
        };

        if (schemaData.length === 0) {
             const domData = scrapeFromDom();
             if (domData.name && (domData.recipe_ingredients?.length > 0 || domData.recipe_instructions?.length > 0)) {
                log.info(`Found recipe via DOM: ${domData.name}`);
                schemaData.push({ '@type': 'Recipe', ...domData });
             }
        }

        for (const data of schemaData) {
            const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
            
            for (const item of items) {
              const type = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
              
              if (type.includes('Recipe')) {
                log.info(`Creating recipe entry: ${item.name}`);
                
                // DOM Fallback for instructions
                if (!item.recipeInstructions || item.recipeInstructions.length === 0) {
                   const domData = scrapeFromDom();
                   if (domData.recipe_instructions && domData.recipe_instructions.length > 0) {
                      log.info(`Augmenting ${item.name} with instructions from DOM`);
                      item.recipeInstructions = domData.recipe_instructions;
                   }
                }

                // Image Object Fix
                const imageUrl = (() => {
                    if (typeof item.image === 'string') return item.image;
                    if (Array.isArray(item.image)) return item.image[0];
                    if (item.image && typeof item.image === 'object' && item.image.url) return item.image.url;
                    return null;
                })();

                const recipeData = {
                  url: normalizedUrl, // Use normalized URL
                  name: item.name,
                  image: imageUrl,
                  description: item.description,
                  cook_time: item.cookTime,
                  prep_time: item.prepTime,
                  total_time: item.totalTime,
                  recipe_yield: item.recipeYield ? String(item.recipeYield) : null,
                  recipe_ingredients: item.recipeIngredient,
                  recipe_instructions: (() => {
                    if (Array.isArray(item.recipeInstructions)) {
                      const instructions: string[] = [];
                      item.recipeInstructions.forEach((inst: any) => {
                        if (inst['@type'] === 'HowToSection' && Array.isArray(inst.itemListElement)) {
                          inst.itemListElement.forEach((step: any) => {
                            if (step['@type'] === 'HowToStep' && step.text) {
                              instructions.push(step.text);
                            }
                          });
                        } else if (inst['@type'] === 'HowToStep' && inst.text) {
                            instructions.push(inst.text);
                        } else if (typeof inst === 'string') {
                            instructions.push(inst);
                        }
                      });
                      return instructions;
                    } else if (typeof item.recipeInstructions === 'string') {
                       return [item.recipeInstructions];
                    }
                    return item.recipeInstructions;
                  })(),

                  recipe_category: Array.isArray(item.recipeCategory) ? item.recipeCategory.join(', ') : item.recipeCategory,
                  recipe_cuisine: Array.isArray(item.recipeCuisine) ? item.recipeCuisine.join(', ') : item.recipeCuisine,
                  nutrition: item.nutrition,
                  updated_at: new Date().toISOString(),
                };

                // QUALITY GATE
                const qualityScore = calculateScore(recipeData);
                if (qualityScore < 60) {
                    log.info(`Skipped low quality recipe (${qualityScore}/100): ${item.name}`);
                    continue; 
                }

                const { error } = await supabase
                  .from('recipes')
                  .upsert({ ...recipeData, quality_score: qualityScore }, { onConflict: 'url' });

                if (error) {
                  log.error(`Failed to save recipe: ${error.message}`);
                } else {
                  foundInPage++; 
                  recipesFound++;
                  await this.updateJobProgress(recipesFound);
                }
              }
            }
        }

        if (foundInPage === 0) { 
             log.info(`No recipes found on ${normalizedUrl}`);
        }
      },
      failedRequestHandler: async ({ request, error }) => {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('403') || errorMessage.includes('429') || errorMessage.includes('blocked')) {
             const retryDelayHours = 24 * (request.retryCount + 1);
             const nextRetry = new Date(Date.now() + retryDelayHours * 60 * 60 * 1000).toISOString();
             await this.updateJobStatus('cooling_down', undefined, `Blocked (Final): ${errorMessage}. Retrying in ${retryDelayHours} hours.`, nextRetry);
        } else {
             errors.push(`Request failed ${request.url}: ${errorMessage}`);
        }
      },
    });

    try {
      if (!this.crawler) throw new Error("Crawler not initialized");
      await this.crawler.run([this.startUrl]);
      await this.updateJobStatus('completed', recipesFound, errors.length > 0 ? errors.join('\n') : undefined);
    } catch (e: any) {
      if (e.message !== 'Crawl blocked, cooling down.') {
          await this.updateJobStatus('failed', recipesFound, e.message);
      }
    }
  }

  private async updateJobStatus(status: JobStatus, count?: number, log?: string, nextRetryAt?: string) {
    const update: any = { status, updated_at: new Date().toISOString() };
    if (count !== undefined) update.recipes_found = count;
    if (log) update.log = log;
    if (nextRetryAt) update.next_retry_at = nextRetryAt;

    await supabase.from('crawl_jobs').update(update).eq('id', this.jobId);
  }

  private async updateJobProgress(count: number) {
    await supabase.from('crawl_jobs').update({ recipes_found: count }).eq('id', this.jobId);
  }

  static setStopAllCrawls(value: boolean) {
    shouldStopAllCrawls = value;
  }
}