// Unit tests for NutritionEngine.resolveWeightFromPortions (private static).
// Accessed via `as any` cast — standard pattern for testing TypeScript internals
// without polluting the public API.
//
// This function was the root cause of the 1080 kcal overcount bug:
// the old code used portions[0] as a last resort when no size keyword matched,
// causing Foundation Food portions (measure='serving') to return arbitrary
// gram weights (e.g. 304g Florida avocado) for count-based ingredients.

jest.mock('../supabaseClient', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}));

import { NutritionEngine } from '../services/nutritionEngine';

type Portion = { measure: string; gramWeight: number };
const resolve = (portions: Portion[] | null, unit: string, qty: number): number | null =>
  (NutritionEngine as any).resolveWeightFromPortions(portions, unit, qty);

// ─── Guard conditions ──────────────────────────────────────────────────────────

describe('resolveWeightFromPortions — empty/null guard', () => {
  it('returns null for empty portions array', () => {
    expect(resolve([], '', 1)).toBeNull();
  });

  it('returns null for null portions', () => {
    expect(resolve(null, '', 1)).toBeNull();
  });
});

// ─── Metric units pass-through ─────────────────────────────────────────────────
// Volume and weight units are handled by unitToGrams; portions shouldn't override them.

describe('resolveWeightFromPortions — metric units return null', () => {
  const portions: Portion[] = [{ measure: 'large', gramWeight: 50 }];

  it('passes through grams', () => {
    expect(resolve(portions, 'g', 100)).toBeNull();
    expect(resolve(portions, 'gram', 50)).toBeNull();
  });

  it('passes through kilograms', () => {
    expect(resolve(portions, 'kg', 1)).toBeNull();
  });

  it('passes through ounces and pounds', () => {
    expect(resolve(portions, 'oz', 4)).toBeNull();
    expect(resolve(portions, 'lb', 1)).toBeNull();
  });

  it('passes through volume units', () => {
    expect(resolve(portions, 'cup', 1)).toBeNull();
    expect(resolve(portions, 'cups', 2)).toBeNull();
    expect(resolve(portions, 'tbsp', 2)).toBeNull();
    expect(resolve(portions, 'ml', 100)).toBeNull();
    expect(resolve(portions, 'l', 1)).toBeNull();
    expect(resolve(portions, 'tsp', 1)).toBeNull();
  });
});

// ─── Size keyword matching ─────────────────────────────────────────────────────

describe('resolveWeightFromPortions — size keyword matching', () => {
  it('matches exact "large" and scales by qty', () => {
    expect(resolve([{ measure: 'large', gramWeight: 50 }], '', 1)).toBe(50);
    expect(resolve([{ measure: 'large', gramWeight: 50 }], '', 2)).toBe(100);
  });

  it('matches "large" inside a longer description (e.g. "1 large egg")', () => {
    expect(resolve([{ measure: '1 large egg', gramWeight: 50 }], '', 2)).toBe(100);
  });

  it('matches "extra large" via the large-synonym list', () => {
    expect(resolve([{ measure: 'extra large', gramWeight: 63 }], '', 1)).toBe(63);
  });

  it('matches "xl" via the large-synonym list', () => {
    expect(resolve([{ measure: 'xl egg', gramWeight: 63 }], '', 1)).toBe(63);
  });

  it('matches "medium" (exact)', () => {
    expect(resolve([{ measure: 'medium', gramWeight: 44 }], '', 1)).toBe(44);
  });

  it('matches "medium" inside a descriptor (e.g. "California, medium")', () => {
    expect(resolve([{ measure: 'California, medium', gramWeight: 136 }], '', 1)).toBe(136);
  });

  it('matches "whole"', () => {
    expect(resolve([{ measure: 'whole fruit', gramWeight: 200 }], '', 1)).toBe(200);
  });

  it('matches "piece" via the whole-synonym list', () => {
    expect(resolve([{ measure: '1 piece', gramWeight: 80 }], '', 2)).toBe(160);
  });

  it('matches "item" via the whole-synonym list', () => {
    expect(resolve([{ measure: 'item', gramWeight: 120 }], '', 1)).toBe(120);
  });

  it('prefers "large" over "medium" — SIZE_KEYWORDS order', () => {
    const portions: Portion[] = [
      { measure: 'medium', gramWeight: 44 },
      { measure: 'large', gramWeight: 50 },
    ];
    // SIZE_KEYWORDS tries 'large' before 'medium' → first match in portions array
    // 'medium': doesn't include 'large' → skip
    // 'large': includes 'large' → match at index 1 → 50g
    expect(resolve(portions, '', 1)).toBe(50);
  });
});

// ─── Explicit unit matching ───────────────────────────────────────────────────

describe('resolveWeightFromPortions — explicit unit matching', () => {
  it('matches "slices" unit against a "slice" portion', () => {
    expect(resolve([{ measure: '1 slice, raw', gramWeight: 19 }], 'slices', 2)).toBe(38);
  });

  it('matches "slice" unit (already singular)', () => {
    expect(resolve([{ measure: 'slice', gramWeight: 20 }], 'slice', 3)).toBe(60);
  });

  it('matches "cloves" unit against garlic portion', () => {
    expect(resolve([{ measure: 'garlic clove', gramWeight: 5 }], 'cloves', 3)).toBe(15);
  });

  it('matches "head" unit', () => {
    expect(resolve([{ measure: 'head', gramWeight: 400 }], 'head', 1)).toBe(400);
  });

  it('matches "bunch" unit', () => {
    expect(resolve([{ measure: 'bunch', gramWeight: 30 }], 'bunch', 2)).toBe(60);
  });

  it('matches "sprig" unit', () => {
    expect(resolve([{ measure: 'sprig', gramWeight: 3 }], 'sprigs', 4)).toBe(12);
  });
});

// ─── Regression: no last-resort portions[0] ────────────────────────────────────
//
// BUG (fixed): resolveWeightFromPortions previously fell back to portions[0].gramWeight
// when no size keyword matched and the unit was empty. USDA Foundation Foods return
// portions with measure = 'serving' — a generic label that never matches any keyword.
// For "1 avocado", portions[0] was 304g (Florida avocado), giving 486 kcal instead of
// the correct ~250 kcal derived from unitToGrams's 150g estimate.
//
// The fix: return null so the caller uses unitToGrams with ingredient-specific weights.

describe('resolveWeightFromPortions — regression: no last-resort portions[0]', () => {
  it('returns null when all portions have measure="serving" (Foundation Food style)', () => {
    const portions: Portion[] = [
      { measure: 'serving', gramWeight: 304 }, // Florida avocado — old code returned this!
      { measure: 'serving', gramWeight: 150 },
    ];
    expect(resolve(portions, '', 1)).toBeNull();
  });

  it('returns null for cup-based portions with no count unit given', () => {
    const portions: Portion[] = [
      { measure: 'cup, cubed', gramWeight: 150 },
      { measure: 'cup, pureed', gramWeight: 230 },
    ];
    expect(resolve(portions, '', 1)).toBeNull();
  });

  it('returns null when only a tablespoon portion exists and no unit given', () => {
    expect(resolve([{ measure: 'tablespoon', gramWeight: 15 }], '', 1)).toBeNull();
  });

  it('returns null for a single non-matching portion (not portions[0])', () => {
    expect(resolve([{ measure: 'container', gramWeight: 500 }], '', 1)).toBeNull();
  });
});
