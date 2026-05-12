// Tests for the cooking state inference system.
//
// The core problem: "1 cup quinoa" is calorie-ambiguous:
//   - Raw/dry: ~651 kcal/cup (standard recipe convention; also used in stews)
//   - Cooked:  ~222 kcal/cup (salads, grain bowls — pre-cooked before measuring)
//
// detectCookingState() reads the ingredient line for explicit signals.
// inferDishContext()   infers the dish type from a recipe name.
// resolveCookingState() combines both to produce a final 'raw' | 'cooked' decision.

import {
    detectCookingState,
    resolveCookingState,
    inferDishContext,
    resolveContext,
    getCookedDensity,
    DISH_CONTEXT_DESCRIPTIONS,
    DishContext,
} from '../utils/cookingState';

// ─── detectCookingState ────────────────────────────────────────────────────────

describe('detectCookingState — explicit signals', () => {
    it('returns "cooked" for explicit cooked words', () => {
        expect(detectCookingState('1 cup cooked quinoa', 'quinoa')).toBe('cooked');
        expect(detectCookingState('200g boiled chickpeas', 'chickpeas')).toBe('cooked');
        expect(detectCookingState('steamed rice', 'rice')).toBe('cooked');
        expect(detectCookingState('braised lentils', 'lentils')).toBe('cooked');
    });

    it('returns "cooked" for canned/tinned signals', () => {
        expect(detectCookingState('1 can canned tomatoes', 'tomatoes')).toBe('cooked');
        expect(detectCookingState('400g tinned chickpeas', 'chickpeas')).toBe('cooked');
        expect(detectCookingState('1 jar chickpeas in brine', 'chickpeas')).toBe('cooked');
        expect(detectCookingState('pre-cooked lentils', 'lentils')).toBe('cooked');
    });

    it('returns "raw" for explicit raw/dry signals', () => {
        expect(detectCookingState('1 cup dry lentils', 'lentils')).toBe('raw');
        expect(detectCookingState('uncooked rice', 'rice')).toBe('raw');
        expect(detectCookingState('raw quinoa', 'quinoa')).toBe('raw');
        expect(detectCookingState('dried chickpeas', 'chickpeas')).toBe('raw');
    });

    it('returns "ambiguous" for grains/legumes with no qualifier', () => {
        expect(detectCookingState('1 cup quinoa', 'quinoa')).toBe('ambiguous');
        expect(detectCookingState('1 cup rice', 'rice')).toBe('ambiguous');
        expect(detectCookingState('1 cup chickpeas', 'chickpeas')).toBe('ambiguous');
        expect(detectCookingState('200g lentils', 'lentils')).toBe('ambiguous');
        expect(detectCookingState('1 cup pasta', 'pasta')).toBe('ambiguous');
    });

    it('returns "raw" for non-grain ingredients with no qualifier', () => {
        expect(detectCookingState('2 eggs', 'eggs')).toBe('raw');
        expect(detectCookingState('1 avocado', 'avocado')).toBe('raw');
        expect(detectCookingState('100g spinach', 'spinach')).toBe('raw');
        expect(detectCookingState('3 garlic cloves', 'garlic')).toBe('raw');
    });

    it('cooked signal takes priority over raw in the same line', () => {
        // Edge case: "cooked" appears before "dry" signal
        expect(detectCookingState('cooked dry-style lentils', 'lentils')).toBe('cooked');
    });
});

// ─── inferDishContext ─────────────────────────────────────────────────────────

describe('inferDishContext — salad and assembled dishes → "assembled"', () => {
    it('detects salad', () => {
        expect(inferDishContext('Mediterranean Quinoa Salad')).toBe('assembled');
        expect(inferDishContext('Roasted Veggie Salad')).toBe('assembled');
        expect(inferDishContext('Lentil Salad with Herbs')).toBe('assembled');
    });

    it('detects grain bowls', () => {
        expect(inferDishContext('Vegan Grain Bowl')).toBe('assembled');
        expect(inferDishContext('Buddha Bowl with Tahini')).toBe('assembled');
        expect(inferDishContext('Poke Bowl')).toBe('assembled');
        expect(inferDishContext('Power Bowl')).toBe('assembled');
    });

    it('detects wraps and burritos', () => {
        expect(inferDishContext('Chickpea Wrap')).toBe('assembled');
        expect(inferDishContext('Black Bean Burrito')).toBe('assembled');
    });

    it('detects pasta salad', () => {
        expect(inferDishContext('Orzo Pasta Salad')).toBe('assembled');
        expect(inferDishContext('Chickpea Pasta Salad')).toBe('assembled');
    });
});

describe('inferDishContext — stews, soups, curries → "simmered"', () => {
    it('detects stew', () => {
        expect(inferDishContext('Lentil Stew')).toBe('simmered');
        expect(inferDishContext('Moroccan Chickpea Stew')).toBe('simmered');
    });

    it('detects soup', () => {
        expect(inferDishContext('Split Pea Soup')).toBe('simmered');
        expect(inferDishContext('Minestrone Soup')).toBe('simmered');
    });

    it('detects curry', () => {
        expect(inferDishContext('Thai Green Curry')).toBe('simmered');
        expect(inferDishContext('Red Lentil Curry')).toBe('simmered');
    });

    it('detects chili', () => {
        expect(inferDishContext('Black Bean Chili')).toBe('simmered');
        expect(inferDishContext('Beef Chilli')).toBe('simmered');
    });

    it('detects risotto and pilaf (grains added raw into liquid)', () => {
        expect(inferDishContext('Mushroom Risotto')).toBe('simmered');
        expect(inferDishContext('Rice Pilaf')).toBe('simmered');
        expect(inferDishContext('Chicken Paella')).toBe('simmered');
    });

    it('detects slow cooker and one-pot', () => {
        expect(inferDishContext('Slow Cooker Lentil Soup')).toBe('simmered');
        expect(inferDishContext('One Pot Rice Dish')).toBe('simmered');
    });
});

describe('inferDishContext — stir-fry → "stir-fry"', () => {
    it('detects stir-fry', () => {
        expect(inferDishContext('Shrimp Stir-Fry')).toBe('stir-fry');
        expect(inferDishContext('Vegetable Stir Fry')).toBe('stir-fry');
    });

    it('detects fried rice', () => {
        expect(inferDishContext('Egg Fried Rice')).toBe('stir-fry');
        expect(inferDishContext('Pork Fried Rice')).toBe('stir-fry');
    });

    it('detects noodle stir-fry', () => {
        expect(inferDishContext('Pad Thai')).toBe('stir-fry');
        expect(inferDishContext('Lo Mein Noodles')).toBe('stir-fry');
    });
});

describe('inferDishContext — baked pasta/casseroles → "baked"', () => {
    it('detects casserole', () => {
        expect(inferDishContext('Tuna Noodle Casserole')).toBe('baked');
        expect(inferDishContext('Rice Casserole')).toBe('baked');
    });

    it('detects pasta bake', () => {
        expect(inferDishContext('Pasta Bake')).toBe('baked');
        expect(inferDishContext('Baked Pasta with Cheese')).toBe('baked');
    });

    it('detects lasagna and gratin', () => {
        expect(inferDishContext('Classic Lasagna')).toBe('baked');
        expect(inferDishContext('Potato Gratin')).toBe('baked');
    });

    it('detects mac and cheese', () => {
        expect(inferDishContext('Mac and Cheese')).toBe('baked');
        expect(inferDishContext('Macaroni Cheese')).toBe('baked');
    });
});

describe('inferDishContext — no match → "standard"', () => {
    it('returns standard for generic dish names', () => {
        expect(inferDishContext('Grilled Chicken')).toBe('standard');
        expect(inferDishContext('Roasted Vegetables')).toBe('standard');
        expect(inferDishContext('Scrambled Eggs')).toBe('standard');
        expect(inferDishContext('Banana Bread')).toBe('standard');
    });

    it('returns standard for empty or short strings', () => {
        expect(inferDishContext('')).toBe('standard');
        expect(inferDishContext('Pasta')).toBe('standard'); // too generic
    });
});

// ─── resolveCookingState ──────────────────────────────────────────────────────

describe('resolveCookingState — explicit signals bypass context', () => {
    it('raw signal is always raw, regardless of context', () => {
        expect(resolveCookingState('raw', 'assembled')).toBe('raw');
        expect(resolveCookingState('raw', 'simmered')).toBe('raw');
        expect(resolveCookingState('raw', 'stir-fry')).toBe('raw');
    });

    it('cooked signal is always cooked, regardless of context', () => {
        expect(resolveCookingState('cooked', 'standard')).toBe('cooked');
        expect(resolveCookingState('cooked', 'simmered')).toBe('cooked');
        expect(resolveCookingState('cooked', 'baked')).toBe('cooked');
    });
});

describe('resolveCookingState — ambiguous resolved by dish context', () => {
    it('assembled → cooked (salad, grain bowl)', () => {
        expect(resolveCookingState('ambiguous', 'assembled')).toBe('cooked');
    });

    it('stir-fry → cooked (rice/noodles pre-cooked before wok)', () => {
        expect(resolveCookingState('ambiguous', 'stir-fry')).toBe('cooked');
    });

    it('simmered → raw (stew/soup: grains go in dry)', () => {
        expect(resolveCookingState('ambiguous', 'simmered')).toBe('raw');
    });

    it('baked → raw (pasta bake: dry pasta absorbs liquid in oven)', () => {
        expect(resolveCookingState('ambiguous', 'baked')).toBe('raw');
    });

    it('standard → raw (default recipe convention)', () => {
        expect(resolveCookingState('ambiguous', 'standard')).toBe('raw');
    });
});

// ─── Full inference chain ──────────────────────────────────────────────────────

describe('Full inference chain: ingredient + dish name → final state', () => {
    function fullInfer(ingredientLine: string, cleanedName: string, recipeName: string) {
        const detected = detectCookingState(ingredientLine, cleanedName);
        const context  = inferDishContext(recipeName);
        return resolveCookingState(detected, context);
    }

    it('"1 cup quinoa" in a salad → cooked', () => {
        expect(fullInfer('1 cup quinoa', 'quinoa', 'Mediterranean Quinoa Salad')).toBe('cooked');
    });

    it('"1 cup chickpeas" in a stew → raw (added dry)', () => {
        expect(fullInfer('1 cup chickpeas', 'chickpeas', 'Moroccan Chickpea Stew')).toBe('raw');
    });

    it('"1 cup rice" in a risotto → raw (added dry into broth)', () => {
        expect(fullInfer('1 cup rice', 'rice', 'Mushroom Risotto')).toBe('raw');
    });

    it('"1 cup rice" in fried rice → cooked', () => {
        expect(fullInfer('1 cup rice', 'rice', 'Egg Fried Rice')).toBe('cooked');
    });

    it('"cooked quinoa" in a stew → cooked (explicit signal wins)', () => {
        expect(fullInfer('1 cup cooked quinoa', 'quinoa', 'Quinoa Stew')).toBe('cooked');
    });

    it('"dry lentils" in a salad → raw (explicit signal wins)', () => {
        expect(fullInfer('1 cup dry lentils', 'lentils', 'Lentil Salad')).toBe('raw');
    });

    it('"2 eggs" in a salad → raw (eggs are not in AMBIGUOUS_GRAINS)', () => {
        expect(fullInfer('2 eggs', 'eggs', 'Cobb Salad')).toBe('raw');
    });
});

// ─── getCookedDensity ──────────────────────────────────────────────────────────

describe('getCookedDensity', () => {
    it('returns cooked density for quinoa (185g/cup)', () => {
        const density = getCookedDensity('quinoa');
        expect(density).not.toBeNull();
        expect(density!).toBeCloseTo(185 / 236.59, 3);
    });

    it('returns cooked density for chickpeas (164g/cup)', () => {
        const density = getCookedDensity('chickpeas');
        expect(density).not.toBeNull();
        expect(density!).toBeCloseTo(164 / 236.59, 3);
    });

    it('returns cooked density for lentils (200g/cup)', () => {
        const density = getCookedDensity('lentils');
        expect(density).not.toBeNull();
        expect(density!).toBeCloseTo(200 / 236.59, 3);
    });

    it('returns null for ingredients not in the cooked table', () => {
        expect(getCookedDensity('spinach')).toBeNull();
        expect(getCookedDensity('avocado')).toBeNull();
        expect(getCookedDensity('olive oil')).toBeNull();
    });

    it('matches by substring (e.g. "whole lentils" matches "lentils")', () => {
        expect(getCookedDensity('whole lentils')).not.toBeNull();
        expect(getCookedDensity('cooked chickpeas')).not.toBeNull();
    });
});

// ─── resolveContext ───────────────────────────────────────────────────────────

describe('resolveContext', () => {
    it('returns explicit context when valid', () => {
        expect(resolveContext('assembled', null)).toEqual({ context: 'assembled', inferred: false });
        expect(resolveContext('simmered',  null)).toEqual({ context: 'simmered',  inferred: false });
        expect(resolveContext('stir-fry',  null)).toEqual({ context: 'stir-fry',  inferred: false });
        expect(resolveContext('baked',     null)).toEqual({ context: 'baked',     inferred: false });
        expect(resolveContext('standard',  null)).toEqual({ context: 'standard',  inferred: false });
    });

    it('rejects unknown explicit values and falls through to recipeName', () => {
        const result = resolveContext('deep-fried' as DishContext, 'Quinoa Salad');
        expect(result.context).toBe('assembled');
        expect(result.inferred).toBe(true);
    });

    it('infers context from recipeName when explicit is null', () => {
        expect(resolveContext(null, 'Lentil Stew').context).toBe('simmered');
        expect(resolveContext(null, 'Egg Fried Rice').context).toBe('stir-fry');
        expect(resolveContext(null, 'Quinoa Salad').context).toBe('assembled');
    });

    it('marks inferred=true only when auto-detected away from standard', () => {
        expect(resolveContext(null, 'Lentil Stew').inferred).toBe(true);
        expect(resolveContext(null, 'Grilled Chicken').inferred).toBe(false); // → standard
    });

    it('returns standard with inferred=false when both are missing', () => {
        expect(resolveContext(null, null)).toEqual({ context: 'standard', inferred: false });
        expect(resolveContext(null, '')).toEqual({ context: 'standard', inferred: false });
        expect(resolveContext(undefined, undefined)).toEqual({ context: 'standard', inferred: false });
    });

    it('explicit takes priority over recipeName', () => {
        // Even though recipeName says "stew", explicit says "assembled"
        const result = resolveContext('assembled', 'Lentil Stew');
        expect(result.context).toBe('assembled');
        expect(result.inferred).toBe(false);
    });
});

// ─── DISH_CONTEXT_DESCRIPTIONS completeness ───────────────────────────────────

describe('DISH_CONTEXT_DESCRIPTIONS', () => {
    const ALL_CONTEXTS: DishContext[] = ['standard', 'assembled', 'simmered', 'stir-fry', 'baked'];

    it('has a description for every DishContext value', () => {
        for (const ctx of ALL_CONTEXTS) {
            expect(DISH_CONTEXT_DESCRIPTIONS[ctx]).toBeTruthy();
            expect(typeof DISH_CONTEXT_DESCRIPTIONS[ctx]).toBe('string');
        }
    });

    it('descriptions are non-empty and human readable (>20 chars)', () => {
        for (const ctx of ALL_CONTEXTS) {
            expect(DISH_CONTEXT_DESCRIPTIONS[ctx].length).toBeGreaterThan(20);
        }
    });
});
