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
        'thawed', 'defrosted', 'blanched', 'parboiled', 'marinated',
        'fresh', 'frozen', 'canned', 'dried',
        'flat-leaf', 'flat leaf', 'curly', 'heirloom',
        'extra virgin', 'virgin',
        // Cutting / size descriptors
        'cut', 'into', 'pieces', 'chunks', 'wedges', 'strips', 'rings',
        // Explanatory / example phrases: "such as X, Y" → strip "such", "as"
        'such', 'as',
        // Recipe instruction words that survive parenthetical removal
        // "see note", "see headnote" → "note" / "see" end up as search terms
        'see', 'note', 'headnote',
        // Vegetable prep state words not already covered
        'root', 'roots', 'ends', 'trimmed', 'off',
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
        // Bell pepper → "Pepper, black" wins via USDA scoring because "Pepper, black"
        // starts with "pepper," (score +300) while "Peppers, sweet, green" only contains
        // "pepper" (score +10). Redirecting to "sweet pepper" fixes the score race.
        'green bell pepper': 'sweet bell pepper',
        'red bell pepper':   'sweet bell pepper',
        'yellow bell pepper':'sweet bell pepper',
        'orange bell pepper':'sweet bell pepper',
        'bell pepper':       'sweet bell pepper',
        // Green/spring onion variants → consistent USDA term
        'scallions':         'green onions',
        'spring onions':     'green onions',
        // Tomato variants that match wrong foods without disambiguation
        'grape tomatoes':    'tomatoes',      // otherwise matches "Grape Juice"
        'cherry tomatoes':   'tomatoes',
        'sun dried tomatoes':'tomatoes',
        // Grain disambiguation
        'wheat berries':     'wheat grain',   // otherwise matches generic "Berries"
        // Dairy
        'double cream':      'heavy cream',
        'single cream':      'light cream',
        // British → American (USDA uses American names)
        'aubergine':         'eggplant',
        'courgette':         'zucchini',
        'coriander':         'cilantro',
        'rocket':            'arugula',
        // Root vegetables — USDA has specific entries but generic searches miss them
        'daikon':            'daikon radish',   // prevents matching tiny garden "Radishes, raw"
        'daikon radish':     'daikon radish',
        // Seeds with non-English names
        'pepitas':           'pumpkin seeds',   // USDA lists these as "pumpkin seeds" not "pepitas"
        // Small potato varieties — USDA doesn't have "mini/baby potato"; prevents FatSecret
        // from matching processed products (potato gems, hash browns) at 300+ kcal/100g
        'mini potato':       'potato',
        'baby potato':       'potato',
        'new potato':        'potato',
        'fingerling':        'potato',
        // Meat
        'minced beef':       'ground beef',
        'minced pork':       'ground pork',
        // Alcohol — OFW sometimes returns wrong calorie-dense match for generic terms
        'spirits':           'vodka',
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
        // Try last word only (the core noun) — but skip words that are too ambiguous
        // when used alone because they reliably match the WRONG USDA food.
        //   "bell pepper" → "pepper" → hits "Pepper, black, ground" (399 kcal/100g) not "Peppers, sweet"
        //   "lemon juice" → "juice" → hits generic fruit juice
        //   "heavy cream" → "cream" → could hit cream cheese or sour cream
        //   "chicken stock" → "stock" → hits beef stock or vegetable stock
        const BARE_AMBIGUOUS = new Set([
            'pepper',  // disambiguated via AMBIGUITY_FIXES; bare "pepper" hits black pepper spice
            'cream',   // too many cream variants in USDA
            'juice',   // hits wrong juice
            'stock',   // beef/chicken/veg disambiguation lost
            'sauce',   // too many sauces
            'butter',  // regular butter vs almond/peanut/cocoa butter
            'oil',     // olive vs vegetable vs coconut all have very different nutrition
        ]);
        const lastWord = words[words.length - 1];
        if (!terms.includes(lastWord) && !BARE_AMBIGUOUS.has(lastWord)) terms.push(lastWord);
    }

    // Deduplicate while preserving order
    return [...new Set(terms)];
}
