/**
 * Strips preparation noise from an ingredient string so it can be used as a
 * search term against USDA / FatSecret.
 *
 * Design principles:
 *  1. Remove cooking STATE words (melted, chopped, dried…) — they change nothing
 *     nutritionally and confuse search.
 *  2. Remove filler/instruction words (for, about, to taste…).
 *  3. Do NOT remap ingredient names to specific USDA titles — that only covers
 *     ingredients we thought of. Let the search engine handle disambiguation.
 *  4. Keep a tiny list of TRUE AMBIGUITY FIXES where the generic name would
 *     reliably match the wrong food (e.g. "grape tomatoes" → "Grape Juice").
 */
export function cleanIngredientTerm(term: string): string {
    if (!term) return '';

    let cleaned = term.toLowerCase()
        // Remove parenthetical asides: "butter (softened)" → "butter"
        .replace(/\([^)]*\)/g, ' ')
        // Remove punctuation (use space to avoid merging adjacent words)
        .replace(/[.,/#!$%^&*;:{}=\-_`~]/g, ' ')
        // Remove digits — quantity parsing has already happened
        .replace(/[0-9]/g, ' ');

    // Preparation methods and states — nutritionally irrelevant for search
    const PREP_WORDS = [
        'melted', 'softened', 'chopped', 'sliced', 'diced', 'minced', 'crushed',
        'beaten', 'sifted', 'warm', 'cold', 'hot', 'boiling', 'room temperature',
        'ripe', 'raw', 'cooked', 'steamed', 'baked', 'fried', 'grilled', 'broiled',
        'freshly', 'lightly', 'heavily', 'gently', 'quickly',
        'sautéed', 'sauteed', 'presoaked', 'soaked', 'drained', 'rinsed', 'peeled',
        'cored', 'seeded', 'halved', 'quartered', 'cubed', 'grated', 'shredded',
        'mashed', 'pureed', 'julienned', 'toasted', 'roasted', 'smoked', 'pickled',
        'lengthwise', 'crosswise', 'thinly', 'thickly', 'finely', 'coarsely',
        'roughly', 'boneless', 'skinless', 'packed', 'tightly', 'loosely',
        'divided', 'separated', 'reserved', 'removed', 'discarded', 'pitted',
        'fresh', 'frozen', 'canned', 'dried',
        'flat-leaf', 'flat leaf', 'curly', 'heirloom',
        'extra virgin', 'virgin',
        // Count/container descriptors that aren't part of the food name
        'stalk', 'stalks', 'sprig', 'sprigs', 'bunch', 'bunches', 'floret', 'florets',
        'about', 'plus', 'more', 'optional', 'garnish', 'taste', 'serving',
        'hours', 'minutes', 'overnight', 'needed', 'necessary', 'desired',
        'for', 'and', 'with', 'in', 'to', 'of', 'or', 'then', 'if',
        'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
        // Units that survive parsing — strip them so only the food name remains
        'cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon',
        'teaspoons', 'pint', 'quart', 'gallon', 'oz', 'ounce', 'ounces',
        'gram', 'grams', 'lb', 'pound', 'pounds', 'kg', 'liter', 'liters', 'ml',
    ];

    for (const word of PREP_WORDS) {
        cleaned = cleaned.replace(new RegExp(`\\b${word}\\b`, 'gi'), '');
    }

    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // ── Ambiguity fixes only ─────────────────────────────────────────────────
    // These are cases where the generic cleaned name reliably matches the WRONG
    // food in USDA. Keep this list small and specific.
    const AMBIGUITY_FIXES: Record<string, string> = {
        'grape tomatoes':    'tomatoes',      // otherwise matches "Grape Juice"
        'cherry tomatoes':   'tomatoes',
        'sun dried tomatoes':'tomatoes',
        'wheat berries':     'wheat grain',   // otherwise matches generic "Berries"
        'scallions':         'green onions',
        'spring onions':     'green onions',
        'double cream':      'heavy cream',
        'single cream':      'light cream',
        'aubergine':         'eggplant',      // British → American
        'courgette':         'zucchini',
        'coriander':         'cilantro',      // British herb name → American
        'rocket':            'arugula',
        'minced beef':       'ground beef',
        'minced pork':       'ground pork',
    };

    return AMBIGUITY_FIXES[cleaned] ?? cleaned;
}

/**
 * Returns an ordered list of search terms to try against USDA/FatSecret.
 * Tries progressively simpler terms so uncommon ingredients are still found.
 *
 * Examples:
 *   "almond flour"       → ["almond flour", "almond"]
 *   "whole wheat pasta"  → ["whole wheat pasta", "wheat pasta", "pasta"]
 *   "kabocha squash"     → ["kabocha squash", "squash"]
 *   "spaghetti"          → ["spaghetti"]
 *   "miso paste"         → ["miso paste", "miso"]
 */
export function getSearchTerms(rawName: string): string[] {
    const primary = cleanIngredientTerm(rawName);
    if (!primary) return [];

    const terms: string[] = [primary];

    const words = primary.split(/\s+/).filter(w => w.length >= 2);

    if (words.length >= 3) {
        // Try last two words (often "adjective noun noun" → drop first adjective)
        terms.push(words.slice(-2).join(' '));
    }

    if (words.length >= 2) {
        // Try last word only (the core noun)
        const lastWord = words[words.length - 1];
        if (!terms.includes(lastWord)) terms.push(lastWord);
    }

    // Deduplicate while preserving order
    return [...new Set(terms)];
}
