// Calorie accuracy regression tests.
//
// Bug: "2 eggs + 1 avocado + 2 slices bacon" returned 1080 kcal (correct: 400–600).
//
// Root cause: resolveWeightFromPortions used portions[0] as a last resort when
// USDA Foundation Food portions have measure = 'serving' (never matches SIZE_KEYWORDS).
// For avocado, portions[0] was a 304g Florida avocado → 486 kcal for 1 avocado alone.
//
// These tests mock USDA to return Foundation Food-style portions and verify the engine
// stays within realistic calorie ranges.

jest.mock('../supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
      upsert: () => ({ then: () => {} }),
    }),
  },
}));

jest.mock('../services/baselineNutrition', () => ({ lookupBaseline: jest.fn().mockReturnValue(null) }));
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

beforeEach(() => {
  mockUsda.mockReset();
  mockFs.mockReset();
  mockOff.mockReset();
  mockFs.mockResolvedValue(null);
  mockOff.mockResolvedValue(null);
});

// USDA Foundation Food-style responses: portions[].measure = 'serving' (never matches
// SIZE_KEYWORDS, triggering the old last-resort bug).
const FOUNDATION_EGG = {
  calories: 143, protein: 12.6, fat: 9.5, carbs: 0.7, fiber: 0, sugar: 0.4,
  calcium_mg: 56, iron_mg: 1.8, vitamin_a_mcg: 160, vitamin_c_mg: 0,
  serving_size_g: 100,
  portions: [{ measure: 'serving', gramWeight: 63 }],
};

const FOUNDATION_AVOCADO = {
  calories: 167, protein: 2, fat: 15, carbs: 8.5, fiber: 6.7, sugar: 0.7,
  calcium_mg: 12, iron_mg: 0.55, vitamin_a_mcg: 7, vitamin_c_mg: 8.8,
  serving_size_g: 100,
  // OLD CODE: returned portions[0] = 304g → 167 * 3.04 = 508 kcal for 1 avocado
  // NEW CODE: returns null → unitToGrams('', 1, 'avocado') = 150g → 250 kcal
  portions: [{ measure: 'serving', gramWeight: 304 }],
};

const FOUNDATION_BACON = {
  calories: 540, protein: 37, fat: 42, carbs: 1.4, fiber: 0, sugar: 0,
  calcium_mg: 12, iron_mg: 0.9, vitamin_a_mcg: 0, vitamin_c_mg: 0,
  serving_size_g: 100,
  portions: [{ measure: '1 slice, raw', gramWeight: 19 }],
};

// ─── Individual ingredient weight checks ──────────────────────────────────────

describe('Calorie accuracy — individual ingredient weights', () => {
  it('"2 eggs" → unitToGrams fallback: 50g × 2 = 100g → ~143 kcal', async () => {
    mockUsda.mockResolvedValue(FOUNDATION_EGG);

    const { total, breakdown } = await NutritionEngine.analyze(['2 eggs']);

    expect(breakdown[0].parsed.weightGrams).toBe(100);
    expect(total.calories).toBeGreaterThanOrEqual(100);
    expect(total.calories).toBeLessThanOrEqual(200);
  });

  it('"1 avocado" → NOT 304g from portions[0]; unitToGrams gives 150g → ~250 kcal', async () => {
    mockUsda.mockResolvedValue(FOUNDATION_AVOCADO);

    const { total, breakdown } = await NutritionEngine.analyze(['1 avocado']);

    expect(breakdown[0].parsed.weightGrams).toBe(150);
    expect(total.calories).toBeGreaterThanOrEqual(200);
    expect(total.calories).toBeLessThanOrEqual(320);
  });

  it('"2 slices bacon" → USDA slice portion (19g each) = 38g → ~205 kcal', async () => {
    mockUsda.mockResolvedValue(FOUNDATION_BACON);

    const { total, breakdown } = await NutritionEngine.analyze(['2 slices bacon']);

    expect(breakdown[0].parsed.weightGrams).toBeCloseTo(38, 0);
    expect(total.calories).toBeGreaterThanOrEqual(150);
    expect(total.calories).toBeLessThanOrEqual(280);
  });
});

// ─── Full combo regression ─────────────────────────────────────────────────────

describe('Calorie accuracy — "2 eggs + 1 avocado + 2 slices bacon" regression', () => {
  it('total calories are in the 350–700 range (not 1080)', async () => {
    mockUsda.mockImplementation(async (query: string) => {
      if (query.includes('egg'))     return FOUNDATION_EGG;
      if (query.includes('avocado')) return FOUNDATION_AVOCADO;
      if (query.includes('bacon'))   return FOUNDATION_BACON;
      return null;
    });

    const { total, breakdown } = await NutritionEngine.analyze([
      '2 eggs',
      '1 avocado',
      '2 slices bacon',
    ]);

    // Expected approximate breakdown:
    //   eggs:    100g × 1.43 = ~143 kcal
    //   avocado: 150g × 1.67 = ~251 kcal
    //   bacon:    38g × 5.40 = ~205 kcal
    //   total  ≈ 599 kcal
    expect(total.calories).toBeGreaterThanOrEqual(350);
    expect(total.calories).toBeLessThanOrEqual(700);
    expect(breakdown).toHaveLength(3);
    expect(breakdown.every((b: any) => b.status !== 'not_found')).toBe(true);
  });
});

// ─── Common ingredient weight accuracy ────────────────────────────────────────

describe('Calorie accuracy — explicit weight ingredients', () => {
  const CHICKEN = {
    calories: 165, protein: 31, fat: 3.6, carbs: 0, fiber: 0, sugar: 0,
    calcium_mg: 15, iron_mg: 1.0, vitamin_a_mcg: 18, vitamin_c_mg: 0,
    serving_size_g: 100, portions: [],
  };

  it('"100g chicken breast" → exact 165 kcal', async () => {
    mockUsda.mockResolvedValue(CHICKEN);
    const { total } = await NutritionEngine.analyze(['100g chicken breast']);
    expect(total.calories).toBe(165);
  });

  it('"200g chicken breast" → exact 330 kcal', async () => {
    mockUsda.mockResolvedValue(CHICKEN);
    const { total } = await NutritionEngine.analyze(['200g chicken breast']);
    expect(total.calories).toBe(330);
  });

  it('"0.5 lb chicken breast" → 227g → ~374 kcal', async () => {
    mockUsda.mockResolvedValue(CHICKEN);
    const { total } = await NutritionEngine.analyze(['0.5 lb chicken breast']);
    // 0.5 × 453.59 ≈ 226.8g
    expect(total.calories).toBeGreaterThanOrEqual(360);
    expect(total.calories).toBeLessThanOrEqual(390);
  });
});

describe('Calorie accuracy — count ingredients using unitToGrams table', () => {
  const DUMMY = (cal: number) => ({
    calories: cal, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0,
    calcium_mg: 0, iron_mg: 0, vitamin_a_mcg: 0, vitamin_c_mg: 0,
    serving_size_g: 100, portions: [],
  });

  it('"1 egg yolk" → 17g weight', async () => {
    mockUsda.mockResolvedValue(DUMMY(322));
    const { breakdown } = await NutritionEngine.analyze(['1 egg yolk']);
    expect(breakdown[0].parsed.weightGrams).toBe(17);
  });

  it('"1 egg white" → 33g weight', async () => {
    mockUsda.mockResolvedValue(DUMMY(52));
    const { breakdown } = await NutritionEngine.analyze(['1 egg white']);
    expect(breakdown[0].parsed.weightGrams).toBe(33);
  });

  it('"1 banana" → 120g weight', async () => {
    mockUsda.mockResolvedValue(DUMMY(89));
    const { breakdown } = await NutritionEngine.analyze(['1 banana']);
    expect(breakdown[0].parsed.weightGrams).toBe(120);
  });

  it('"1 apple" → 182g weight (USDA medium apple)', async () => {
    mockUsda.mockResolvedValue(DUMMY(52));
    const { breakdown } = await NutritionEngine.analyze(['1 apple']);
    expect(breakdown[0].parsed.weightGrams).toBe(182);
  });

  it('"1 medium potato" → 213g weight', async () => {
    mockUsda.mockResolvedValue(DUMMY(77));
    const { breakdown } = await NutritionEngine.analyze(['1 potato']);
    expect(breakdown[0].parsed.weightGrams).toBe(213);
  });

  it('"2 slices bread" → 30g each = 60g weight', async () => {
    mockUsda.mockResolvedValue(DUMMY(265));
    const { breakdown } = await NutritionEngine.analyze(['2 slices bread']);
    expect(breakdown[0].parsed.weightGrams).toBeCloseTo(60, 5);
  });
});

// ─── Volume + density accuracy ────────────────────────────────────────────────

describe('Calorie accuracy — volume ingredients with density table', () => {
  const DUMMY = (cal: number) => ({
    calories: cal, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0,
    calcium_mg: 0, iron_mg: 0, vitamin_a_mcg: 0, vitamin_c_mg: 0,
    serving_size_g: 100, portions: [],
  });

  it('"1 cup water" → 237g (density 1.0)', async () => {
    mockUsda.mockResolvedValue(DUMMY(0));
    const { breakdown } = await NutritionEngine.analyze(['1 cup water']);
    expect(breakdown[0].parsed.weightGrams).toBeCloseTo(236.59, 0);
  });

  it('"1 cup flour" → ~130g (density 0.55)', async () => {
    mockUsda.mockResolvedValue(DUMMY(364));
    const { breakdown } = await NutritionEngine.analyze(['1 cup flour']);
    // 236.59 × 0.55 ≈ 130g
    expect(breakdown[0].parsed.weightGrams).toBeCloseTo(130, 0);
  });

  it('"1 cup rice" → ~201g (density 0.85)', async () => {
    mockUsda.mockResolvedValue(DUMMY(365));
    const { breakdown } = await NutritionEngine.analyze(['1 cup rice']);
    // 236.59 × 0.85 ≈ 201g
    expect(breakdown[0].parsed.weightGrams).toBeCloseTo(201, 0);
  });

  it('"2 tbsp olive oil" → ~27g (volume × density)', async () => {
    mockUsda.mockResolvedValue(DUMMY(884));
    const { breakdown } = await NutritionEngine.analyze(['2 tbsp olive oil']);
    // 2 × 14.79ml × 0.92 g/ml ≈ 27.2g
    expect(breakdown[0].parsed.weightGrams).toBeCloseTo(27, 0);
  });
});

// ─── Unicode fraction handling ────────────────────────────────────────────────

describe('Unicode fraction parsing', () => {
  const DUMMY = () => ({
    calories: 100, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0,
    calcium_mg: 0, iron_mg: 0, vitamin_a_mcg: 0, vitamin_c_mg: 0,
    serving_size_g: 100, portions: [],
  });

  it('parses ½ as 0.5', async () => {
    mockUsda.mockResolvedValue(DUMMY());
    const { breakdown } = await NutritionEngine.analyze(['½ cup oats']);
    expect(breakdown[0].parsed.qty).toBeCloseTo(0.5, 2);
  });

  it('parses ¼ as 0.25', async () => {
    mockUsda.mockResolvedValue(DUMMY());
    const { breakdown } = await NutritionEngine.analyze(['¼ tsp salt']);
    expect(breakdown[0].parsed.qty).toBeCloseTo(0.25, 2);
  });

  it('parses ¾ as 0.75', async () => {
    mockUsda.mockResolvedValue(DUMMY());
    const { breakdown } = await NutritionEngine.analyze(['¾ cup sugar']);
    expect(breakdown[0].parsed.qty).toBeCloseTo(0.75, 2);
  });

  it('parses ⅓ as 0.333', async () => {
    mockUsda.mockResolvedValue(DUMMY());
    const { breakdown } = await NutritionEngine.analyze(['⅓ cup milk']);
    expect(breakdown[0].parsed.qty).toBeCloseTo(0.333, 2);
  });
});
