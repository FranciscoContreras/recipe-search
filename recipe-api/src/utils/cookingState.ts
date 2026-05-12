// Cooking state detection for ingredients.
//
// Problem: "1 cup quinoa" is ambiguous — in a baking recipe it's dry/raw (651 kcal),
// but in a salad it was cooked before assembling (222 kcal). The caller must resolve
// ambiguity via cookingContext ('standard' | 'assembled') when it cannot be inferred
// from the ingredient line itself.

export type CookingState = 'raw' | 'cooked' | 'ambiguous';

// Ingredients that require cooking and are often measured in their cooked state
// when listed in assembled dishes (salads, grain bowls, wraps).
export const AMBIGUOUS_GRAINS: ReadonlySet<string> = new Set([
    'quinoa', 'rice', 'farro', 'barley', 'bulgur', 'millet', 'couscous',
    'polenta', 'grits', 'freekeh', 'spelt',
    'lentils', 'lentil', 'chickpeas', 'chickpea', 'garbanzo',
    'beans', 'bean', 'black beans', 'kidney beans', 'pinto beans',
    'white beans', 'cannellini', 'edamame',
    'pasta', 'noodles', 'spaghetti', 'fettuccine', 'penne', 'rigatoni',
    'orzo', 'fusilli', 'farfalle', 'linguine', 'tagliatelle',
]);

const COOKED_SIGNALS = /\b(cooked|boiled|steamed|simmered|braised|blanched|poached)\b/i;
const CANNED_SIGNALS = /\b(canned|tinned|jarred|in brine|in water|pre-?cooked|ready[-\s]?to[-\s]?eat)\b/i;
const RAW_SIGNALS    = /\b(raw|uncooked|dry|dried|uncooked)\b/i;

export function detectCookingState(ingredientLine: string, cleanedName: string): CookingState {
    if (COOKED_SIGNALS.test(ingredientLine)) return 'cooked';
    if (CANNED_SIGNALS.test(ingredientLine)) return 'cooked'; // canned = pre-cooked
    if (RAW_SIGNALS.test(ingredientLine))    return 'raw';
    if (AMBIGUOUS_GRAINS.has(cleanedName.toLowerCase())) return 'ambiguous';
    return 'raw'; // default: raw (standard recipe convention for non-grain ingredients)
}

// Per-cup gram weights and densities for cooked grains/legumes.
// Used to convert volume measurements when the ingredient is known to be cooked.
export const COOKED_VOLUME_GRAMS: Record<string, number> = {
    'quinoa':    185, // 1 cup cooked quinoa ≈ 185g
    'rice':      200, // 1 cup cooked rice   ≈ 200g
    'farro':     200,
    'barley':    200,
    'bulgur':    191,
    'millet':    200,
    'couscous':  175,
    'polenta':   240,
    'grits':     240,
    'lentils':   200,
    'chickpeas': 164,
    'garbanzo':  164,
    'beans':     173, // generic beans
    'edamame':   155,
    'pasta':     140, // 1 cup cooked pasta (varies by shape; 140g is a common average)
};

// Density in g/ml derived from COOKED_VOLUME_GRAMS (divide by 236.59 ml/cup).
export function getCookedDensity(ingredientName: string): number | null {
    const lower = ingredientName.toLowerCase();
    for (const [key, gramsPerCup] of Object.entries(COOKED_VOLUME_GRAMS)) {
        if (lower.includes(key)) return gramsPerCup / 236.59;
    }
    return null;
}
