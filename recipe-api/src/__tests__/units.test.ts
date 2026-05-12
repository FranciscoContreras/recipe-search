// NutritionEngine.unitToGrams and parseQuantity are now public static so they can be
// tested directly without mocking the database or external APIs.

// Supabase is imported by nutritionEngine at module load; mock it to avoid needing
// real credentials in CI.
jest.mock('../supabaseClient', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}));

import { NutritionEngine } from '../services/nutritionEngine';

describe('NutritionEngine.parseQuantity', () => {
  it('parses whole numbers', () => {
    expect(NutritionEngine.parseQuantity('2')).toBe(2);
    expect(NutritionEngine.parseQuantity('10')).toBe(10);
  });

  it('parses simple fractions', () => {
    expect(NutritionEngine.parseQuantity('1/2')).toBeCloseTo(0.5);
    expect(NutritionEngine.parseQuantity('1/4')).toBeCloseTo(0.25);
    expect(NutritionEngine.parseQuantity('3/4')).toBeCloseTo(0.75);
    expect(NutritionEngine.parseQuantity('2/3')).toBeCloseTo(0.667, 2);
  });

  it('parses mixed numbers like "1 1/2"', () => {
    expect(NutritionEngine.parseQuantity('1 1/2')).toBeCloseTo(1.5);
    expect(NutritionEngine.parseQuantity('2 1/4')).toBeCloseTo(2.25);
  });

  it('returns 1 for empty or invalid input', () => {
    expect(NutritionEngine.parseQuantity('')).toBe(1);
    expect(NutritionEngine.parseQuantity('abc')).toBe(1);
  });

  it('guards against division by zero', () => {
    expect(NutritionEngine.parseQuantity('1/0')).toBe(1); // 0 den → skipped, total stays 0 → returns 1
  });
});

describe('NutritionEngine.unitToGrams', () => {
  const any = 'ingredient'; // ingredient name placeholder

  // --- Weight units ---
  it('converts grams directly', () => {
    expect(NutritionEngine.unitToGrams('g', 100, any)).toBe(100);
    expect(NutritionEngine.unitToGrams('gram', 50, any)).toBe(50);
  });

  it('converts kilograms', () => {
    expect(NutritionEngine.unitToGrams('kg', 1, any)).toBe(1000);
    expect(NutritionEngine.unitToGrams('kg', 0.5, any)).toBe(500);
  });

  it('converts ounces', () => {
    expect(NutritionEngine.unitToGrams('oz', 1, any)).toBeCloseTo(28.35);
    expect(NutritionEngine.unitToGrams('oz', 4, any)).toBeCloseTo(113.4);
  });

  it('converts pounds', () => {
    expect(NutritionEngine.unitToGrams('lb', 1, any)).toBeCloseTo(453.59);
  });

  // --- Volume units (using default density 1.0 for water) ---
  it('converts millilitres', () => {
    expect(NutritionEngine.unitToGrams('ml', 100, 'water')).toBeCloseTo(100);
  });

  it('converts litres', () => {
    expect(NutritionEngine.unitToGrams('l', 1, 'water')).toBeCloseTo(1000);
  });

  it('converts cups with water density', () => {
    // 1 cup = 236.59 ml, density 1.0 → 236.59g
    expect(NutritionEngine.unitToGrams('cup', 1, 'water')).toBeCloseTo(236.59);
  });

  it('converts cups with flour density', () => {
    // flour density = 0.55 → 236.59 * 0.55 ≈ 130.1g
    expect(NutritionEngine.unitToGrams('cup', 1, 'flour')).toBeCloseTo(130.1, 0);
  });

  // --- THE BUG FIX: capital T = tablespoon, lowercase t = teaspoon ---
  it('treats capital T as tablespoon (14.79 ml)', () => {
    expect(NutritionEngine.unitToGrams('T', 1, 'water')).toBeCloseTo(14.79);
    expect(NutritionEngine.unitToGrams('T', 2, 'water')).toBeCloseTo(29.58);
  });

  it('treats lowercase t as teaspoon (4.93 ml)', () => {
    expect(NutritionEngine.unitToGrams('t', 1, 'water')).toBeCloseTo(4.93);
  });

  it('T and t produce different amounts (tablespoon ≠ teaspoon)', () => {
    const tbsp = NutritionEngine.unitToGrams('T', 1, 'water');
    const tsp  = NutritionEngine.unitToGrams('t', 1, 'water');
    expect(tbsp).toBeGreaterThan(tsp * 2); // tbsp is ~3× tsp
  });

  it('treats tbsp as tablespoon', () => {
    expect(NutritionEngine.unitToGrams('tbsp', 1, 'water')).toBeCloseTo(14.79);
    expect(NutritionEngine.unitToGrams('tbs', 1, 'water')).toBeCloseTo(14.79);
    expect(NutritionEngine.unitToGrams('tablespoon', 1, 'water')).toBeCloseTo(14.79);
    expect(NutritionEngine.unitToGrams('tablespoons', 1, 'water')).toBeCloseTo(14.79);
  });

  it('treats tsp as teaspoon', () => {
    expect(NutritionEngine.unitToGrams('tsp', 1, 'water')).toBeCloseTo(4.93);
    expect(NutritionEngine.unitToGrams('teaspoon', 1, 'water')).toBeCloseTo(4.93);
    expect(NutritionEngine.unitToGrams('teaspoons', 1, 'water')).toBeCloseTo(4.93);
  });

  // --- Count / abstract units ---
  it('estimates a pinch as 0.3g', () => {
    expect(NutritionEngine.unitToGrams('pinch', 1, 'salt')).toBeCloseTo(0.3);
  });

  it('estimates a dash as 0.6g', () => {
    expect(NutritionEngine.unitToGrams('dash', 1, 'bitters')).toBeCloseTo(0.6);
  });

  it('estimates a garlic clove at 5g', () => {
    expect(NutritionEngine.unitToGrams('clove', 1, 'garlic')).toBe(5);
    expect(NutritionEngine.unitToGrams('cloves', 3, 'garlic')).toBe(15);
  });

  it('uses spice default for known spice keywords with no unit', () => {
    // No unit given, ingredient contains "salt" → 2g per count
    expect(NutritionEngine.unitToGrams('', 1, 'salt')).toBe(2);
    expect(NutritionEngine.unitToGrams('', 1, 'black pepper')).toBe(2);
    expect(NutritionEngine.unitToGrams('', 1, 'vanilla extract')).toBe(2);
  });

  it('uses egg default (50g) with no unit', () => {
    expect(NutritionEngine.unitToGrams('', 1, 'egg')).toBe(50);
    expect(NutritionEngine.unitToGrams('', 2, 'egg')).toBe(100);
  });

  it('uses banana default (120g) with no unit', () => {
    expect(NutritionEngine.unitToGrams('', 1, 'banana')).toBe(120);
  });

  it('falls back to 100g per unit for unknown ingredients', () => {
    expect(NutritionEngine.unitToGrams('', 1, 'mystery vegetable')).toBe(100);
    expect(NutritionEngine.unitToGrams('', 3, 'mystery vegetable')).toBe(300);
  });
});

describe('NutritionEngine.getDensity', () => {
  it('returns known densities', () => {
    expect(NutritionEngine.getDensity('flour')).toBe(0.55);
    expect(NutritionEngine.getDensity('honey')).toBe(1.42);
    expect(NutritionEngine.getDensity('olive oil')).toBe(0.92); // matches 'oil'
    expect(NutritionEngine.getDensity('spinach leaves')).toBe(0.12); // matches 'spinach'
  });

  it('returns 1.0 for unknown ingredients (water density default)', () => {
    expect(NutritionEngine.getDensity('mystery ingredient')).toBe(1.0);
    expect(NutritionEngine.getDensity('')).toBe(1.0);
  });
});
