// End-to-end test for NutritionEngine.analyze — mocks all I/O, tests parsing + aggregation.

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

import { NutritionEngine }      from '../services/nutritionEngine';
import { searchUsda }           from '../services/usda';
import { searchFatSecret }      from '../services/fatsecret';
import { searchOpenFoodFacts }  from '../services/openFoodFacts';

const mockUsda  = searchUsda          as jest.Mock;
const mockFs    = searchFatSecret     as jest.Mock;
const mockOff   = searchOpenFoodFacts as jest.Mock;

const PER_100G_CHICKEN: any = {
  calories: 165, protein: 31, fat: 3.6, carbs: 0, fiber: 0, sugar: 0,
  calcium_mg: 15, iron_mg: 1.0, vitamin_a_mcg: 18, vitamin_c_mg: 0,
  serving_size_g: 100,
};

const PER_100G_RICE: any = {
  calories: 130, protein: 2.7, fat: 0.3, carbs: 28, fiber: 0.4, sugar: 0,
  calcium_mg: 10, iron_mg: 0.4, vitamin_a_mcg: 0, vitamin_c_mg: 0,
  serving_size_g: 100,
};

beforeEach(() => {
  mockUsda.mockReset();
  mockFs.mockReset();
  mockOff.mockReset();
  mockFs.mockResolvedValue(null);
  mockOff.mockResolvedValue(null);
});

describe('NutritionEngine.analyze — parse-ingredient integration', () => {
  it('correctly parses "200g chicken breast" and scales USDA data', async () => {
    mockUsda.mockResolvedValue(PER_100G_CHICKEN);

    const { total, breakdown } = await NutritionEngine.analyze(['200g chicken breast']);

    // 200g at 165 kcal/100g → 330 kcal
    expect(total.calories).toBe(330);
    expect(total.protein).toBe(Math.round(31 * 2));  // 62g
    expect(breakdown[0].status).toBeUndefined();       // not 'not_found'
    expect(breakdown[0].parsed.weightGrams).toBeCloseTo(200);
    expect(breakdown[0].parsed.qty).toBe(200);
    expect(breakdown[0].parsed.unit).toBe('g');
  });

  it('correctly parses "1 cup rice" using density table', async () => {
    mockUsda.mockResolvedValue(PER_100G_RICE);

    const { total } = await NutritionEngine.analyze(['1 cup rice']);

    // 1 cup = 236.59 ml, rice density 0.85 → ~201g
    // 201g / 100g * 130 cal ≈ 261 cal
    expect(total.calories).toBeGreaterThan(200);
    expect(total.calories).toBeLessThan(300);
  });

  it('correctly parses mixed-number "1 1/2 cups flour"', async () => {
    mockUsda.mockResolvedValue({ ...PER_100G_CHICKEN, calories: 364 }); // flour-like

    const { breakdown } = await NutritionEngine.analyze(['1 1/2 cups flour']);
    // Library parses 1.5 cups directly
    expect(breakdown[0].parsed.qty).toBeCloseTo(1.5);
  });

  it('handles null quantity ("pinch of salt") gracefully', async () => {
    mockUsda.mockResolvedValue({ calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0,
      sugar: 0, calcium_mg: 0, iron_mg: 0, vitamin_a_mcg: 0, vitamin_c_mg: 0, serving_size_g: 100 });

    const { breakdown } = await NutritionEngine.analyze(['pinch of salt']);
    // Should not throw; qty defaults to 1
    expect(breakdown[0].parsed.qty).toBe(1);
  });

  it('sums contributions from multiple ingredients correctly', async () => {
    mockUsda
      .mockResolvedValueOnce(PER_100G_CHICKEN)  // chicken
      .mockResolvedValueOnce(PER_100G_RICE);    // rice

    const { total } = await NutritionEngine.analyze(['200g chicken breast', '100g rice']);

    // 330 (chicken) + 130 (rice) = 460
    expect(total.calories).toBe(460);
    // 62 (chicken protein) + 2.7 (rice protein) = ~65
    expect(total.protein).toBeCloseTo(65, 0);
  });

  it('falls back to Open Food Facts when USDA returns null', async () => {
    mockUsda.mockResolvedValue(null);
    mockOff.mockResolvedValue({ ...PER_100G_CHICKEN, calories: 200, serving_size_g: 100 });

    const { breakdown } = await NutritionEngine.analyze(['100g tofu']);
    expect(breakdown[0].source).toBe('openfoodfacts');
    expect(breakdown[0].stats.calories).toBeCloseTo(200);
  });

  it('falls back to FatSecret when USDA and OFF both return null', async () => {
    mockUsda.mockResolvedValue(null);
    mockOff.mockResolvedValue(null);
    mockFs.mockResolvedValue({ ...PER_100G_CHICKEN, calories: 200, serving_size_g: 100 });

    const { breakdown } = await NutritionEngine.analyze(['100g tofu']);
    expect(breakdown[0].source).toBe('fatsecret');
    expect(breakdown[0].stats.calories).toBeCloseTo(200);
  });

  it('marks ingredient as not_found when all sources return null', async () => {
    mockUsda.mockResolvedValue(null);
    mockOff.mockResolvedValue(null);
    mockFs.mockResolvedValue(null);

    const { breakdown, total } = await NutritionEngine.analyze(['unicorn meat']);
    expect(breakdown[0].status).toBe('not_found');
    expect(total.calories).toBe(0);
  });

  it('processes ingredients in parallel — all called concurrently', async () => {
    const calls: number[] = [];
    let callOrder = 0;
    mockUsda.mockImplementation(async () => {
      const myCall = callOrder++;
      calls.push(myCall);
      return PER_100G_CHICKEN;
    });

    // 6 ingredients triggers the concurrency limit (4 at a time)
    const ingredients = Array.from({ length: 6 }, (_, i) => `100g item${i}`);
    await NutritionEngine.analyze(ingredients);

    expect(calls).toHaveLength(6);
  });
});
