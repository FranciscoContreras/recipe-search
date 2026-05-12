// Cooking state inference for recipe ingredients.
//
// The core problem: "1 cup quinoa" is ambiguous.
//   - In a SALAD it means pre-cooked quinoa (already assembled): ~222 kcal/cup
//   - In a STEW  it means dry quinoa (goes in raw, cooks in the broth): ~651 kcal/cup
//   - In STANDARD recipe convention (default) it means raw: ~651 kcal/cup
//
// Resolution order:
//   1. Explicit signals in the ingredient line ("cooked", "canned", "dry")
//   2. Dish context from the recipe type (salad → assembled, stew → simmered, …)
//   3. Auto-detection from a recipe name / title string via inferDishContext()

export type CookingState = 'raw' | 'cooked' | 'ambiguous';

// ─── Dish context taxonomy ─────────────────────────────────────────────────────
//
// Each context defines how ambiguous grains/legumes should be treated.
// The key insight is WHERE calories come from:
//   assembled → ingredient was already cooked before measuring ("1 cup cooked quinoa")
//   simmered  → ingredient is measured dry and cooks in the liquid ("1 cup dry lentils")
//   stir-fry  → rice/noodles cooked separately then tossed in (cooked)
//   baked     → pasta/grains go into the dish dry and absorb liquid in the oven (raw)
//   standard  → default recipe-ingredient convention (raw/dry)

export type DishContext =
    | 'standard'   // default — grains measured dry before cooking
    | 'assembled'  // cold assembly: salad, grain bowl, poke, wrap, tabbouleh
    | 'simmered'   // wet cooking: stew, soup, curry, chili, risotto, congee
    | 'stir-fry'   // rice/noodles pre-cooked then wok-tossed
    | 'baked';     // pasta bake, lasagna, casserole — dry into the dish

// How each dish context resolves an ambiguous grain/legume
const DISH_GRAIN_STATE: Record<DishContext, 'raw' | 'cooked'> = {
    standard:  'raw',    // recipe convention: list dry, cook later
    assembled: 'cooked', // pre-cooked and measured in cooked state
    simmered:  'raw',    // added dry; liquid handles cooking
    'stir-fry':'cooked', // pre-cooked; just reheated in wok
    baked:     'raw',    // dry pasta/grains absorb liquid in the oven
};

// ─── Ingredient-level signal detection ────────────────────────────────────────

// Ingredients that require cooking and are often measured in their cooked state
// when listed in assembled dishes (salads, grain bowls, wraps, etc.).
export const AMBIGUOUS_GRAINS: ReadonlySet<string> = new Set([
    'quinoa', 'rice', 'farro', 'barley', 'bulgur', 'millet', 'couscous',
    'polenta', 'grits', 'freekeh', 'spelt', 'amaranth',
    'lentils', 'lentil', 'chickpeas', 'chickpea', 'garbanzo',
    'beans', 'bean', 'black beans', 'kidney beans', 'pinto beans',
    'white beans', 'cannellini', 'edamame',
    'pasta', 'noodles', 'spaghetti', 'fettuccine', 'penne', 'rigatoni',
    'orzo', 'fusilli', 'farfalle', 'linguine', 'tagliatelle', 'macaroni',
]);

const COOKED_SIGNALS = /\b(cooked|boiled|steamed|simmered|braised|blanched|poached)\b/i;
const CANNED_SIGNALS = /\b(canned|tinned|jarred|in brine|in water|pre-?cooked|ready[-\s]?to[-\s]?eat)\b/i;
const RAW_SIGNALS    = /\b(raw|uncooked|dry|dried)\b/i;

/** Detect cooking state from explicit signals in the ingredient line. */
export function detectCookingState(ingredientLine: string, cleanedName: string): CookingState {
    if (COOKED_SIGNALS.test(ingredientLine)) return 'cooked';
    if (CANNED_SIGNALS.test(ingredientLine)) return 'cooked';
    if (RAW_SIGNALS.test(ingredientLine))    return 'raw';
    if (AMBIGUOUS_GRAINS.has(cleanedName.toLowerCase())) return 'ambiguous';
    return 'raw';
}

/**
 * Resolve the final cooking state for an ingredient, combining the ingredient-level
 * signal (which may be ambiguous) with the dish context (which resolves ambiguity).
 */
export function resolveCookingState(
    detectedState: CookingState,
    dishContext: DishContext,
): 'raw' | 'cooked' {
    if (detectedState !== 'ambiguous') return detectedState;
    return DISH_GRAIN_STATE[dishContext];
}

// ─── Dish context auto-detection ──────────────────────────────────────────────

/**
 * Infer dish context from a recipe name, title, or description string.
 * Returns the most likely DishContext or 'standard' if no signal is found.
 *
 * Examples:
 *   "Mediterranean Quinoa Salad"  → 'assembled'
 *   "Lentil Stew"                 → 'simmered'
 *   "Shrimp Fried Rice"           → 'stir-fry'
 *   "Tuna Noodle Casserole"       → 'baked'
 *   "Grilled Chicken"             → 'standard'
 */
export function inferDishContext(input: string): DishContext {
    const s = input.toLowerCase();

    // ── Assembled / cold-build ─────────────────────────────────────────────────
    // Grains/legumes are pre-cooked before being measured and assembled.
    if (/\b(salad|grain.?bowl|poke.?bowl|buddha.?bowl|nourish.?bowl|power.?bowl|rice.?bowl|bowl)\b/.test(s)
        || /\b(wrap|burrito|taco|sushi|roll|sandwich|pita|flatbread)\b/.test(s)
        || /\b(tabbouleh|tabouleh|mezze|hummus.?bowl|falafel.?bowl)\b/.test(s)
        || /\b(pasta.?salad|grain.?salad|bean.?salad|lentil.?salad|chickpea.?salad)\b/.test(s)
    ) return 'assembled';

    // ── Simmered / wet-cooked ──────────────────────────────────────────────────
    // Grains/legumes are added dry and cook in the broth/sauce.
    if (/\b(stew|soup|broth|stock|chili|chilli|curry|bisque|chowder|gumbo|bouillabaisse)\b/.test(s)
        || /\b(braise|braised|ramen|pho|congee|khichdi|dal|dhal|minestrone|ribollita)\b/.test(s)
        || /\b(risotto|paella|pilaf|pilau|arroz|jollof|biryani)\b/.test(s)
        || /\b(hot.?pot|one.?pot|pressure.?cooker|slow.?cooker|crock.?pot)\b/.test(s)
    ) return 'simmered';

    // ── Stir-fry ──────────────────────────────────────────────────────────────
    // Rice/noodles are cooked first then tossed in the wok.
    if (/\b(stir.?fry|stir.?fried|fried.?rice|pad.?thai|lo.?mein|chow.?mein|yakisoba|udon|ramen.?stir)\b/.test(s)
        || /\b(wok|noodle.?stir|noodle.?bowl)\b/.test(s)
    ) return 'stir-fry';

    // ── Baked ─────────────────────────────────────────────────────────────────
    // Pasta/grains go into the dish dry and absorb liquid in the oven.
    if (/\b(casserole|pasta.?bake|baked.?pasta|gratin|lasagna|lasagne|moussaka)\b/.test(s)
        || /\b(mac.?and.?cheese|mac.?n.?cheese|macaroni.?cheese|macaroni.?and)\b/.test(s)
        || /\b(baked.?ziti|pasta.?al.?forno|tuna.?noodle)\b/.test(s)
    ) return 'baked';

    return 'standard';
}

// ─── Volume-to-weight data for cooked grains/legumes ──────────────────────────
//
// When an ingredient is cooked and measured by volume, we need the cooked
// gram-weight (not the raw density) to compute the correct calorie ratio.

export const COOKED_VOLUME_GRAMS: Record<string, number> = {
    'quinoa':    185, // 1 cup cooked quinoa ≈ 185g
    'rice':      200, // 1 cup cooked white rice ≈ 200g
    'farro':     200,
    'barley':    200,
    'bulgur':    191,
    'millet':    200,
    'couscous':  175,
    'polenta':   240,
    'grits':     240,
    'freekeh':   190,
    'amaranth':  185,
    'lentils':   200,
    'chickpeas': 164,
    'garbanzo':  164,
    'beans':     173, // generic — cannellini/black/pinto average
    'edamame':   155,
    'pasta':     140, // cup of cooked pasta (varies by shape; ~140g average)
    'noodles':   140,
    'macaroni':  140,
    'orzo':      140,
};

// ─── Human-readable context descriptions ──────────────────────────────────────

export const DISH_CONTEXT_DESCRIPTIONS: Record<DishContext, string> = {
    standard:   'Standard recipe convention — ingredients listed dry/raw before cooking',
    assembled:  'Cold-assembled dish — grains/legumes pre-cooked then measured (salads, grain bowls, wraps)',
    simmered:   'Wet-cooked dish — dry grains/legumes added to liquid and cook in the pot (soups, stews, curries, risotto)',
    'stir-fry': 'Stir-fried dish — rice/noodles pre-cooked then wok-tossed (fried rice, pad thai)',
    baked:      'Baked dish — dry pasta/grains absorb liquid in the oven (lasagna, pasta bake, casserole)',
};

/**
 * Resolve dish context from an explicit value or by auto-inferring from a recipe name.
 * Explicit always wins; recipeName auto-infers; falls back to 'standard'.
 * Returns the resolved context and whether it was inferred (vs explicit or default).
 */
export function resolveContext(
    explicit: string | null | undefined,
    recipeName: string | null | undefined,
): { context: DishContext; inferred: boolean } {
    const VALID: DishContext[] = ['standard', 'assembled', 'simmered', 'stir-fry', 'baked'];
    if (explicit && VALID.includes(explicit as DishContext)) {
        return { context: explicit as DishContext, inferred: false };
    }
    if (recipeName) {
        const ctx = inferDishContext(String(recipeName));
        return { context: ctx, inferred: ctx !== 'standard' };
    }
    return { context: 'standard', inferred: false };
}

/** Returns cooked density (g/ml) for a volume-measured cooked ingredient, or null if not known. */
export function getCookedDensity(ingredientName: string): number | null {
    const lower = ingredientName.toLowerCase();
    for (const [key, gramsPerCup] of Object.entries(COOKED_VOLUME_GRAMS)) {
        if (lower.includes(key)) return gramsPerCup / 236.59;
    }
    return null;
}
