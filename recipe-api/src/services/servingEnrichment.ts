/**
 * Serving Size Enrichment Pipeline
 *
 * Resolves the gram weight of one standard item/portion for count-based
 * ingredients (e.g. "3 strips bacon", "2 medium bell peppers") using every
 * available structured data source — eliminating the need for the hardcoded
 * unitToGrams count table for any ingredient that passes through the system.
 *
 * Resolution order (fastest/most-authoritative first):
 *   1. USDA foodPortions already attached to the nutritionInfo object
 *   2. CNF (Canadian Nutrient File) — local Supabase mirror
 *   3. FRIDA (DTU Denmark) — local Supabase mirror (when populated)
 *   4. AUSNUT (Food Standards AUS/NZ) — local Supabase mirror (when populated)
 *   5. Open Food Facts serving_quantity — local Supabase mirror
 *   6. Claude Haiku LLM — one-time call, cached forever after
 *
 * The result is stored in ingredient_cache.serving_grams so it is only
 * ever resolved once per unique ingredient. All subsequent requests hit cache.
 *
 * Usage:
 *   import { enrichServingGrams, applyServingGrams } from './servingEnrichment';
 *
 *   // After a successful nutrition lookup:
 *   enrichServingGrams(cacheKey, ingredientName, unit, cookingState, nutritionInfo)
 *       .catch(() => {}); // fire-and-forget; never blocks the response
 *
 *   // Or synchronously when reading from cache:
 *   const weightG = applyServingGrams(cachedServingGrams, qty);
 */

import Anthropic from '@anthropic-ai/sdk';
import {
    lookupServingSize,
    searchOffServingSize,
    getCachedIngredient,
    updateIngredientCacheServing,
} from '../db/queries';
import { track } from '../utils/background';
import { CookingState } from '../utils/cookingState';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ServingResult {
    serving_grams:       number;
    serving_description: string;
    source:              string;
}

// ─── Source 1: Extract from USDA foodPortions ─────────────────────────────────

/**
 * Given the portions array from a USDA detail fetch, find the best per-item
 * portion. Uses the full USDA portion vocabulary — not just "medium/whole/piece".
 */
export function extractServingFromPortions(
    portions:  Array<{ measure: string; gramWeight: number }> | undefined,
    unit:      string,
    cookingState: CookingState,
): ServingResult | null {
    if (!portions || portions.length === 0) return null;

    const u = (unit || '').toLowerCase().replace(/s$/, '');

    // Portions that represent whole-package/bulk measures — exclude these
    const CONTAINER = /\b(package|pkg|bag|box|container|can|jar|bottle|case|carton|pouch|tray|dozen|pound|lb|ounce|oz)\b/i;

    // Per-item signals: looking for single-item USDA portions
    const PER_ITEM = /\b(slice|strip|piece|item|each|medium|large|small|whole|cookie|cracker|chip|bite|scoop|leaf|clove|ear|stalk|stem|rib|spear|wedge|cube|patty|fillet|filet|breast|thigh|drumstick|leg|head|bunch|link|sprig)\b/i;

    // Prefer cooked portions when cookingState=cooked to get the right calorie density pairing
    const cooked = cookingState === 'cooked';
    const candidates = portions
        .filter(p => PER_ITEM.test(p.measure) && !CONTAINER.test(p.measure) && p.gramWeight > 0 && p.gramWeight < 600)
        .sort((a, b) => {
            const aCooked = /cooked|baked|roasted|boiled/i.test(a.measure);
            const bCooked = /cooked|baked|roasted|boiled/i.test(b.measure);
            if (cooked && aCooked && !bCooked) return -1;
            if (cooked && !aCooked && bCooked) return  1;
            return a.gramWeight - b.gramWeight; // prefer smaller (more likely per-item)
        });

    if (candidates.length === 0) return null;

    // Direct unit match first
    if (u && u.length >= 2) {
        const direct = candidates.find(p => new RegExp(`\\b${u}\\b`, 'i').test(p.measure));
        if (direct) return { serving_grams: direct.gramWeight, serving_description: direct.measure, source: 'usda' };
    }

    // Size-qualified match
    const sizeMatch = candidates.find(p => /\bmedium\b/i.test(p.measure));
    if (sizeMatch) return { serving_grams: sizeMatch.gramWeight, serving_description: sizeMatch.measure, source: 'usda' };

    // Best remaining candidate
    return { serving_grams: candidates[0].gramWeight, serving_description: candidates[0].measure, source: 'usda' };
}

// ─── Source 2-4: CNF / FRIDA / AUSNUT via unified Supabase RPC ───────────────

async function queryMirrorDatabases(ingredientName: string): Promise<ServingResult | null> {
    try {
        const data = await lookupServingSize(ingredientName);
        if (!data || data.length === 0) return null;

        // The RPC returns rows ordered by confidence; pick the best non-outlier value.
        // When two sources agree closely (within 30%), high confidence. Use the median.
        const rows = data.filter(r => r.serving_grams > 0 && r.serving_grams < 1000);

        if (rows.length === 0) return null;

        // Prefer the value that has the most agreement with others (lowest pairwise diff)
        const best = rows.length === 1
            ? rows[0]
            : rows.reduce((acc, row) => {
                const avgDiff = rows.reduce((s, r) => s + Math.abs(r.serving_grams - row.serving_grams), 0) / rows.length;
                const accDiff = rows.reduce((s, r) => s + Math.abs(r.serving_grams - acc.serving_grams), 0) / rows.length;
                return avgDiff < accDiff ? row : acc;
            });

        return {
            serving_grams:       best.serving_grams,
            serving_description: best.serving_description || best.food_name,
            source:              best.source_table,
        };
    } catch {
        return null;
    }
}

// ─── Source 5: OFW serving_quantity ──────────────────────────────────────────

async function queryOffServing(ingredientName: string): Promise<ServingResult | null> {
    try {
        const data = await searchOffServingSize(ingredientName);
        if (!data || data.length === 0) return null;

        // Use the smallest serving that matches (most likely per-item, not per-package).
        // searchOffServingSize already orders by serving_quantity ASC.
        const best = data[0];
        if (!best.serving_quantity) return null;
        return {
            serving_grams:       best.serving_quantity,
            serving_description: best.serving_size_text || `1 serving (${best.serving_quantity}g)`,
            source:              'off',
        };
    } catch {
        return null;
    }
}

// ─── Source 6: Claude Haiku LLM fallback ─────────────────────────────────────

let _anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
    if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return _anthropic;
}

async function queryLLM(
    ingredientName: string,
    unit:           string,
    cookingState:   CookingState,
): Promise<ServingResult | null> {
    if (!process.env.ANTHROPIC_API_KEY) return null;

    try {
        const unitContext = unit && unit.length > 1
            ? `when measured as "${unit}"`
            : 'as one individual item';
        const stateContext = cookingState === 'cooked' ? ' (cooked/prepared)' : '';

        const response = await getAnthropicClient().messages.create({
            model:      'claude-haiku-4-5-20251001',
            max_tokens: 80,
            messages: [{
                role:    'user',
                content: `What does 1 ${ingredientName}${stateContext} weigh in grams ${unitContext}? Reply with JSON only, no explanation: {"grams": <number>, "description": "<e.g. 1 slice cooked>"}`,
            }],
        });

        const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
        const match = text.match(/\{[^}]+\}/);
        if (!match) return null;

        const parsed = JSON.parse(match[0]) as { grams: number; description: string };
        if (!parsed.grams || parsed.grams <= 0 || parsed.grams > 2000) return null;

        return {
            serving_grams:       parsed.grams,
            serving_description: parsed.description || `1 ${unit || 'item'} (${parsed.grams}g)`,
            source:              'llm',
        };
    } catch {
        return null;
    }
}

// ─── Primary export: enrich cache entry ──────────────────────────────────────

/**
 * Resolves the best serving_grams for an ingredient and writes it to the
 * ingredient_cache row. Designed to run fire-and-forget after any cache write.
 *
 * Does nothing if the cache row already has serving_grams populated.
 */
export async function enrichServingGrams(
    cacheKey:       string,
    ingredientName: string,
    unit:           string,
    cookingState:   CookingState,
    usdaPortions?:  Array<{ measure: string; gramWeight: number }>,
): Promise<ServingResult | null> {
    // Check if already enriched
    const existing = await getCachedIngredient(cacheKey);
    if (existing?.serving_grams) return null; // already done

    // Work through the source chain
    let result: ServingResult | null = null;

    // 1. USDA portions (synchronous — already fetched as part of nutrition lookup)
    if (!result && usdaPortions && usdaPortions.length > 0) {
        result = extractServingFromPortions(usdaPortions, unit, cookingState);
    }

    // 2-4. CNF / FRIDA / AUSNUT via unified RPC
    if (!result) {
        result = await queryMirrorDatabases(ingredientName);
    }

    // 5. OFW serving_quantity (only if columns exist — graceful fallback if not yet migrated)
    if (!result) {
        result = await queryOffServing(ingredientName);
    }

    // 6. LLM fallback — one-time resolution, cached forever
    if (!result) {
        result = await queryLLM(ingredientName, unit, cookingState);
    }

    if (!result) return null;

    // Persist to cache in the background — never blocks the response.
    track(updateIngredientCacheServing(
        cacheKey,
        result.serving_grams,
        result.serving_description,
    ));

    return result;
}

/**
 * Quick helper used in the synchronous weight resolution path:
 * if we already have a cached serving_grams, return qty × serving_grams.
 */
export function applyServingGrams(
    cachedServingGrams: number | null | undefined,
    qty:                number,
): number | null {
    if (!cachedServingGrams || cachedServingGrams <= 0) return null;
    return cachedServingGrams * qty;
}
