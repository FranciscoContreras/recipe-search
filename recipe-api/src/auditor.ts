/**
 * Recipe Auditor — heavy-enrichment edition.
 *
 * `pg_cron` (audit-batch schedule, installed by 20260517000000_self_host_compat.sql)
 * now performs the lightweight QA pass — image presence, instruction presence,
 * basic quality flagging — entirely inside Postgres every 5 minutes.
 *
 * The Node auditor is responsible for the heavy work that SQL can't do:
 *   • image URL HEAD validation (network call)
 *   • nutrition backfill via NutritionEngine.analyzeRecipe (USDA / OFW / …)
 *   • HTML entity decoding on the recipe name
 *   • quality score recalculation and quarantine logic
 *   • auto-repair: enqueue a re-crawl for low-quality recipes
 *
 * Runs every 5 minutes (NOT a tight poll loop) — matches the pg_cron cadence
 * so the two stay roughly in step without redundant churn.
 */

import {
    getPendingAuditBatch,
    updateAuditResult,
    findExistingActiveJobForUrl,
    findLastJobForUrl,
    createCrawlJob,
    updateCrawlJobStatus,
} from './db/queries';
import { NutritionEngine } from './services/nutritionEngine';
import { calculateScore } from './utils/scoring';
import { drainBackground } from './utils/background';

const BATCH_SIZE  = 10;            // small — every recipe goes through HTTP + NutritionEngine
const INTERVAL_MS = 5 * 60_000;    // 5 min; pg_cron handles the lightweight checks at the same cadence

let running = false;

async function checkImage(url: string): Promise<boolean> {
    if (!url) return false;
    try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 5000); // 5 s timeout
        const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
        clearTimeout(id);
        return res.ok;
    } catch {
        return false;
    }
}

async function runBatch(): Promise<void> {
    if (running) return;
    running = true;
    try {
        const recipes = await getPendingAuditBatch(BATCH_SIZE);
        if (recipes.length === 0) {
            console.log('[auditor] no work');
            return;
        }
        console.log(`[auditor] processing ${recipes.length}`);

        for (const recipe of recipes) {
            const logs: string[] = [];
            let   status         = 'verified';
            let   nutritionUpdate: unknown = null;

            // A. Image check — auto-repair JSON blobs in the image field, then HEAD-validate.
            let imageUrl: string | null = (recipe as any).image ?? null;
            let imageUpdate: string | null = null;

            if (imageUrl && typeof imageUrl === 'string' && imageUrl.trim().startsWith('{')) {
                try {
                    const parsed = JSON.parse(imageUrl);
                    const extracted = parsed.url || parsed.contentUrl;
                    if (extracted) {
                        imageUrl    = extracted;
                        imageUpdate = extracted;
                        logs.push('Auto-repaired image URL from JSON object.');
                    }
                } catch {
                    // Ignore parse error
                }
            }

            if (imageUrl) {
                const ok = await checkImage(imageUrl);
                if (!ok) {
                    logs.push(`Image URL failed validation: ${imageUrl}`);
                    status = 'flagged';
                }
            } else {
                logs.push('Missing image.');
                status = 'flagged';
            }

            // B. Instruction check
            const instructions = (recipe as any).recipe_instructions;
            if (!instructions || (Array.isArray(instructions) && instructions.length === 0)) {
                logs.push('Missing instructions.');
                status = 'flagged';
            }

            // C. Nutrition backfill via NutritionEngine
            const ingredients = (recipe as any).recipe_ingredients;
            if (
                !(recipe as any).nutrition
                && Array.isArray(ingredients)
                && ingredients.length > 0
            ) {
                console.log(`Attempting nutrition backfill for: ${recipe.name}`);
                try {
                    const result = await NutritionEngine.analyzeRecipe(
                        recipe.name,
                        ingredients as string[],
                    );
                    nutritionUpdate = {
                        ...result.total,
                        dishContext: result.dishContext,
                        source:      result.source,
                        analyzedAt:  result.analyzedAt,
                    };
                    logs.push(`Enriched nutrition via NutritionEngine (context: ${result.dishContext}).`);
                } catch (e: any) {
                    logs.push(`Nutrition backfill failed: ${e.message}`);
                }
            } else if (!(recipe as any).nutrition) {
                logs.push('Missing nutrition — no ingredients to analyze.');
            }

            // D. Clean text — decode HTML entities that sneak in from crawler
            const decodedName = recipe.name
                .replace(/&amp;/g,  '&')
                .replace(/&lt;/g,   '<')
                .replace(/&gt;/g,   '>')
                .replace(/&quot;/g, '"')
                .replace(/&#039;/g, "'")
                .replace(/&apos;/g, "'")
                .trim();

            // E. Calculate score
            const tempRecipe   = { ...recipe, nutrition: nutritionUpdate || (recipe as any).nutrition };
            const qualityScore = calculateScore(tempRecipe);

            // F. Determine status (quarantine + auto-repair logic)
            if (qualityScore < 90) {
                status = 'quarantined';
                logs.push(`Quarantined: Low quality score (${qualityScore}/100).`);

                const recipeUrl: string | null = (recipe as any).url ?? null;
                if (recipeUrl) {
                    // Skip if there's already an active job for this URL
                    const existing = await findExistingActiveJobForUrl(recipeUrl);
                    if (!existing) {
                        const last      = await findLastJobForUrl(recipeUrl);
                        const retryCnt  = last?.retry_count ?? 0;

                        if (retryCnt < 3) {
                            console.log(`Auto-repair crawl scheduled for: ${recipe.name} (Attempt ${retryCnt + 1})`);
                            const job = await createCrawlJob(recipeUrl);
                            // createCrawlJob always inserts retry_count=0 — bump it to mirror the
                            // old behavior so the crawler sees this as a retry attempt.
                            await updateCrawlJobStatus(job.id, {
                                retry_count: retryCnt + 1,
                                log:         'Auto-repair triggered by Auditor (Low Quality Score)',
                            });
                            logs.push(`Scheduled auto-repair crawl (Attempt ${retryCnt + 1}).`);
                        } else {
                            logs.push('Auto-repair exhausted. Permanently hiding (Rejected).');
                            status = 'rejected';
                        }
                    }
                } else {
                    logs.push('Cannot auto-repair: No source URL.');
                    status = 'rejected';
                }
            }

            await updateAuditResult(recipe.id, {
                qa_status:       status,
                quality_score:   qualityScore,
                last_audited_at: new Date().toISOString(),
                audit_log:       logs,
                ...(nutritionUpdate                ? { nutrition: nutritionUpdate as unknown } : {}),
                ...(decodedName !== recipe.name    ? { name:      decodedName }                : {}),
                ...(imageUpdate                    ? { image:     imageUpdate }                : {}),
            });
        }
    } catch (e) {
        console.error('[auditor] batch error', e);
    } finally {
        running = false;
    }
}

async function main(): Promise<void> {
    console.log('[auditor] starting (5-min interval; pg_cron handles lightweight checks)');
    await runBatch(); // immediate first run so /health reflects current state

    const timer = setInterval(() => {
        runBatch().catch((e) => console.error('[auditor]', e));
    }, INTERVAL_MS);

    const shutdown = async (sig: string) => {
        console.log(`[auditor] ${sig}`);
        clearInterval(timer);
        await drainBackground();
        process.exit(0);
    };
    process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
    process.on('SIGINT',  () => { void shutdown('SIGINT'); });
}

main().catch((e) => {
    console.error('[auditor] fatal', e);
    process.exit(1);
});
