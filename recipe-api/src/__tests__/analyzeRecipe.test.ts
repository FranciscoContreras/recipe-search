// Tests for NutritionEngine.analyzeRecipe — the canonical recipe-level entry point.
//
// analyzeRecipe wraps analyze() with:
//   1. Dish context auto-inference from the recipe name
//   2. Defensive filtering of null / non-string ingredient entries
//   3. Provenance metadata (dishContext, source, analyzedAt)

jest.mock('../supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
      upsert: () => ({ then: () => {} }),
    }),
  },
}));

jest.mock('../services/usda',          () => ({ searchUsda:          jest.fn() }));
jest.mock('../services/fatsecret',     () => ({ searchFatSecret:     jest.fn() }));
jest.mock('../services/openFoodFacts', () => ({ searchOpenFoodFacts: jest.fn() }));

import { NutritionEngine }     from '../services/nutritionEngine';
import { searchUsda }          from '../services/usda';
import { searchFatSecret }     from '../services/fatsecret';
import { searchOpenFoodFacts } from '../services/openFoodFacts';

const mockUsda = searchUsda          as jest.Mock;
const mockFs   = searchFatSecret     as jest.Mock;
const mockOff  = searchOpenFoodFacts as jest.Mock;

const PER_100G: any = {
  calories: 165, protein: 31, fat: 3.6, carbs: 0, fiber: 0, sugar: 0,
  calcium_mg: 0, iron_mg: 0, vitamin_a_mcg: 0, vitamin_c_mg: 0,
  serving_size_g: 100, portions: [],
};

beforeEach(() => {
  mockUsda.mockReset();
  mockFs.mockReset();
  mockOff.mockReset();
  mockFs.mockResolvedValue(null);
  mockOff.mockResolvedValue(null);
});

// ─── Return shape ─────────────────────────────────────────────────────────────

describe('analyzeRecipe — return shape', () => {
  it('returns total, breakdown, dishContext, contextInferred, source, analyzedAt', async () => {
    mockUsda.mockResolvedValue(PER_100G);

    const result = await NutritionEngine.analyzeRecipe('Chicken Salad', ['100g chicken breast']);

    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('breakdown');
    expect(result).toHaveProperty('dishContext');
    expect(result).toHaveProperty('contextInferred');
    expect(result).toHaveProperty('source', 'NutritionEngine');
    expect(result).toHaveProperty('analyzedAt');
    expect(typeof result.analyzedAt).toBe('string');
  });

  it('total matches the per-ingredient sum', async () => {
    mockUsda.mockResolvedValue(PER_100G);

    const result = await NutritionEngine.analyzeRecipe('Grilled Chicken', ['100g chicken breast']);

    expect(result.total.calories).toBe(165);
    expect(result.total.protein).toBe(31);
  });
});

// ─── Dish context auto-inference ─────────────────────────────────────────────

describe('analyzeRecipe — dish context inference from recipe name', () => {
  it('infers "assembled" context for a salad recipe name', async () => {
    mockUsda.mockResolvedValue(PER_100G);

    const result = await NutritionEngine.analyzeRecipe(
      'Mediterranean Quinoa Salad',
      ['1 cup quinoa'],
    );

    expect(result.dishContext).toBe('assembled');
    expect(result.contextInferred).toBe(true);
  });

  it('infers "simmered" context for a stew recipe name', async () => {
    mockUsda.mockResolvedValue(PER_100G);

    const result = await NutritionEngine.analyzeRecipe(
      'Lentil Stew',
      ['1 cup lentils'],
    );

    expect(result.dishContext).toBe('simmered');
    expect(result.contextInferred).toBe(true);
  });

  it('defaults to "standard" context for a generic recipe name', async () => {
    mockUsda.mockResolvedValue(PER_100G);

    const result = await NutritionEngine.analyzeRecipe(
      'Grilled Salmon',
      ['200g salmon'],
    );

    expect(result.dishContext).toBe('standard');
    expect(result.contextInferred).toBe(false);
  });

  it('infers "stir-fry" for fried rice', async () => {
    mockUsda.mockResolvedValue(PER_100G);

    const result = await NutritionEngine.analyzeRecipe(
      'Egg Fried Rice',
      ['1 cup rice'],
    );

    expect(result.dishContext).toBe('stir-fry');
  });

  it('infers "baked" for lasagna', async () => {
    mockUsda.mockResolvedValue(PER_100G);

    const result = await NutritionEngine.analyzeRecipe(
      'Classic Lasagna',
      ['200g pasta'],
    );

    expect(result.dishContext).toBe('baked');
  });
});

// ─── Null-safety filter ───────────────────────────────────────────────────────

describe('analyzeRecipe — null-safe ingredient filtering', () => {
  it('filters out null entries from Supabase Json[] columns without crashing', async () => {
    mockUsda.mockResolvedValue(PER_100G);

    // Simulates what arrives when recipe_ingredients is Json[] with nulls
    const result = await NutritionEngine.analyzeRecipe(
      'Test Recipe',
      [null as any, '100g chicken breast', undefined as any, ''],
    );

    // Only the valid string should be analyzed
    expect(result.breakdown).toHaveLength(1);
    expect(result.total.calories).toBe(165);
  });

  it('returns zero totals when all ingredients are null/empty', async () => {
    const result = await NutritionEngine.analyzeRecipe(
      'Empty Recipe',
      [null as any, undefined as any, '', '   '],
    );

    expect(result.breakdown).toHaveLength(0);
    expect(result.total.calories).toBe(0);
  });

  it('handles a completely empty ingredients array', async () => {
    const result = await NutritionEngine.analyzeRecipe('Empty', []);

    expect(result.breakdown).toHaveLength(0);
    expect(result.total.calories).toBe(0);
  });

  it('handles whitespace-only strings (filtered as empty)', async () => {
    const result = await NutritionEngine.analyzeRecipe('Test', ['   ', '\t', '\n']);

    expect(result.breakdown).toHaveLength(0);
  });

  it('passes valid strings through to analysis', async () => {
    mockUsda
      .mockResolvedValueOnce(PER_100G)
      .mockResolvedValueOnce(PER_100G);

    const result = await NutritionEngine.analyzeRecipe(
      'Test',
      [null as any, '100g chicken', null as any, '100g chicken'],
    );

    expect(result.breakdown).toHaveLength(2);
    expect(result.total.calories).toBe(330); // 165 × 2
  });
});
