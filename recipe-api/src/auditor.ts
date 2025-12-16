import { supabase } from './supabaseClient';
import { findNutritionForRecipe } from './services/fatsecret';
import { calculateScore } from './utils/scoring';

const BATCH_SIZE = 10;
const POLL_INTERVAL = 10000;

async function checkImage(url: string): Promise<boolean> {
    if (!url) return false;
    try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 5000); // 5s timeout
        const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
        clearTimeout(id);
        return res.ok;
    } catch (e) {
        return false;
    }
}

async function startAuditor() {
    console.log('Recipe Auditor started...');

    while (true) {
        try {
            // 1. Fetch recipes needing audit
            const { data: recipes, error } = await supabase
                .from('recipes')
                .select('*')
                .or('qa_status.eq.pending,last_audited_at.is.null')
                .limit(BATCH_SIZE);

            if (error) {
                console.error('Auditor fetch error:', error.message);
                await new Promise(r => setTimeout(r, POLL_INTERVAL));
                continue;
            }

            if (!recipes || recipes.length === 0) {
                console.log('No pending recipes. Waiting...');
                await new Promise(r => setTimeout(r, POLL_INTERVAL));
                continue;
            }

            console.log(`Auditing batch of ${recipes.length} recipes...`);

            for (const recipe of recipes) {
                const logs: string[] = [];
                let status = 'verified';
                let nutritionUpdate = null;
                
                // A. Image Check
                let imageUrl = recipe.image;
                let imageUpdate = null;

                // Auto-repair JSON blob in image field
                if (imageUrl && typeof imageUrl === 'string' && imageUrl.trim().startsWith('{')) {
                    try {
                        const parsed = JSON.parse(imageUrl);
                        const extracted = parsed.url || parsed.contentUrl;
                        if (extracted) {
                            imageUrl = extracted;
                            imageUpdate = extracted;
                            logs.push('Auto-repaired image URL from JSON object.');
                        }
                    } catch (e) {
                        // Ignore parse error
                    }
                }

                if (imageUrl) {
                    const isImageValid = await checkImage(imageUrl);
                    if (!isImageValid) {
                        logs.push(`Image URL failed validation: ${imageUrl}`);
                        status = 'flagged';
                    }
                } else {
                    logs.push('Missing image.');
                    status = 'flagged';
                }

                // B. Instruction Check
                if (!recipe.recipe_instructions || (Array.isArray(recipe.recipe_instructions) && recipe.recipe_instructions.length === 0)) {
                    logs.push('Missing instructions.');
                    status = 'flagged';
                }

                // C. Nutrition Enrichment (Backfill)
                if (!recipe.nutrition) {
                    console.log(`Attempting nutrition backfill for: ${recipe.name}`);
                    const newNutrition = await findNutritionForRecipe(recipe.name);
                    if (newNutrition) {
                        nutritionUpdate = newNutrition;
                        logs.push('Enriched nutrition via FatSecret API.');
                        // If it was flagged ONLY for missing nutrition (unlikely logic above, but conceptually), we might upgrade status
                    } else {
                        logs.push('Missing nutrition (Lookup failed or no API key).');
                    }
                }

                // D. Clean Text
                let name = recipe.name;
                if (name && (name.includes('&amp;') || name.includes('&#039;'))) {
                     name = name.trim(); // Simplified cleaning
                }

                // Calculate Score
                const tempRecipe = { ...recipe, nutrition: nutritionUpdate || recipe.nutrition };
                const qualityScore = calculateScore(tempRecipe);

                // Determine Status (Quarantine Logic)
                if (qualityScore < 80) {
                    status = 'quarantined';
                    logs.push(`Quarantined: Low quality score (${qualityScore}/100).`);

                    // AUTO-REPAIR: Schedule a re-crawl
                    if (recipe.url) {
                        // Check if we already have a pending/processing job for this URL to avoid duplicates
                        const { data: existingJob } = await supabase
                            .from('crawl_jobs')
                            .select('id, retry_count')
                            .eq('url', recipe.url)
                            .in('status', ['pending', 'processing', 'cooling_down'])
                            .single();

                        if (!existingJob) {
                            const { data: lastJob } = await supabase
                                .from('crawl_jobs')
                                .select('retry_count, updated_at')
                                .eq('url', recipe.url)
                                .eq('status', 'completed')
                                .order('updated_at', { ascending: false })
                                .limit(1)
                                .single();

                            const retryCount = lastJob ? lastJob.retry_count : 0;

                            if (retryCount < 2) {
                                console.log(`Scheduling auto-repair crawl for: ${recipe.name}`);
                                await supabase.from('crawl_jobs').insert([{
                                    url: recipe.url,
                                    status: 'pending',
                                    retry_count: retryCount + 1,
                                    log: 'Auto-repair triggered by Auditor (Low Quality Score)'
                                }]);
                                logs.push(`Scheduled auto-repair crawl (Attempt ${retryCount + 1}).`);
                            } else {
                                logs.push('Auto-repair exhausted. Human review required.');
                            }
                        }
                    } else {
                        logs.push('Cannot auto-repair: No source URL.');
                    }
                }

                // Update DB
                const updatePayload: any = {
                    qa_status: status,
                    quality_score: qualityScore,
                    last_audited_at: new Date().toISOString(),
                    audit_log: logs
                };

                if (nutritionUpdate) {
                    updatePayload.nutrition = nutritionUpdate;
                }

                if (imageUpdate) {
                    updatePayload.image = imageUpdate;
                }

                await supabase.from('recipes').update(updatePayload).eq('id', recipe.id);
            }

        } catch (e) {
            console.error('Auditor fatal error:', e);
            await new Promise(r => setTimeout(r, POLL_INTERVAL));
        }
    }
}

startAuditor();
