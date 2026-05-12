// Tests for packaged-food detection and source-routing logic in NutritionEngine.
//
// Packaged/branded foods (canned, jarred, bottled goods) are routed to Open Food
// Facts BEFORE USDA, because OFF covers branded products far better. Raw/fresh
// ingredients skip directly to USDA first.

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

const MOCK_RESULT = {
  calories: 100, protein: 5, fat: 3, carbs: 10, fiber: 1, sugar: 2,
  calcium_mg: 0, iron_mg: 0, vitamin_a_mcg: 0, vitamin_c_mg: 0,
  serving_size_g: 100, portions: [],
};

beforeEach(() => {
  mockUsda.mockReset();
  mockFs.mockReset();
  mockOff.mockReset();
  mockFs.mockResolvedValue(null);
});

// ─── Packaged food detection via routing ────────────────────────────────────────
// looksLikePackagedFood is private; tested indirectly via source routing.
// When OFF resolves first, USDA should not have been called at all (or called only
// in the second-pass after OFF fails).

describe('Packaged food routing — OFF called first', () => {
  it('routes "canned tomatoes" to OFF before USDA', async () => {
    mockOff.mockResolvedValue(MOCK_RESULT);

    const { breakdown } = await NutritionEngine.analyze(['200g canned tomatoes']);

    expect(breakdown[0].source).toBe('openfoodfacts');
    expect(mockUsda).not.toHaveBeenCalled();
  });

  // Regression: looksLikePackagedFood must check the FULL original line, not just the
  // parsed description. parse-ingredient strips "can" into the unit field; if only the
  // parsed description ('chickpeas') is checked, the packaged signal is lost and
  // the ingredient is incorrectly routed to USDA first.
  it('"1 can chickpeas" — packaged signal in the unit field, not description', async () => {
    mockOff.mockResolvedValue(MOCK_RESULT);

    const { breakdown } = await NutritionEngine.analyze(['1 can chickpeas']);

    // OFF must be tried first regardless of where parse-ingredient puts 'can'
    expect(breakdown[0].source).toBe('openfoodfacts');
    expect(mockUsda).not.toHaveBeenCalled();
  });

  it('"1 can black beans" — same as above for black beans', async () => {
    mockOff.mockResolvedValue(MOCK_RESULT);

    const { breakdown } = await NutritionEngine.analyze(['1 can black beans']);

    expect(breakdown[0].source).toBe('openfoodfacts');
    expect(mockUsda).not.toHaveBeenCalled();
  });

  it('routes "tin of chickpeas" to OFF before USDA', async () => {
    mockOff.mockResolvedValue(MOCK_RESULT);

    const { breakdown } = await NutritionEngine.analyze(['400g tin of chickpeas']);

    expect(breakdown[0].source).toBe('openfoodfacts');
    expect(mockUsda).not.toHaveBeenCalled();
  });

  it('routes "jar of peanut butter" to OFF first', async () => {
    mockOff.mockResolvedValue(MOCK_RESULT);

    const { breakdown } = await NutritionEngine.analyze(['2 tbsp jar of peanut butter']);

    expect(breakdown[0].source).toBe('openfoodfacts');
    expect(mockUsda).not.toHaveBeenCalled();
  });

  it('routes "store-bought pasta sauce" to OFF first', async () => {
    mockOff.mockResolvedValue(MOCK_RESULT);

    const { breakdown } = await NutritionEngine.analyze(['1 cup store-bought pasta sauce']);

    expect(breakdown[0].source).toBe('openfoodfacts');
    expect(mockUsda).not.toHaveBeenCalled();
  });
});

describe('Packaged food routing — falls back to USDA when OFF returns null', () => {
  it('falls through to USDA second-pass when OFF has no result', async () => {
    mockOff.mockResolvedValue(null);
    mockUsda.mockResolvedValue(MOCK_RESULT);

    const { breakdown } = await NutritionEngine.analyze(['200g canned beans']);

    // USDA was called (second-pass for packaged items) and provided the result
    expect(mockUsda).toHaveBeenCalled();
    expect(breakdown[0].source).toBe('usda');
  });
});

// ─── Raw/fresh food routing — USDA first ─────────────────────────────────────

describe('Non-packaged food routing — USDA called first', () => {
  it('routes "200g chicken breast" to USDA first', async () => {
    mockUsda.mockResolvedValue(MOCK_RESULT);

    const { breakdown } = await NutritionEngine.analyze(['200g chicken breast']);

    expect(breakdown[0].source).toBe('usda');
    expect(mockOff).not.toHaveBeenCalled();
  });

  it('routes "3 eggs" to USDA first', async () => {
    mockUsda.mockResolvedValue(MOCK_RESULT);

    const { breakdown } = await NutritionEngine.analyze(['3 eggs']);

    expect(breakdown[0].source).toBe('usda');
    expect(mockOff).not.toHaveBeenCalled();
  });

  it('routes "100g spinach" to USDA first', async () => {
    mockUsda.mockResolvedValue(MOCK_RESULT);

    const { breakdown } = await NutritionEngine.analyze(['100g spinach']);

    expect(breakdown[0].source).toBe('usda');
    expect(mockOff).not.toHaveBeenCalled();
  });

  it('falls back to OFF when USDA returns null for a raw ingredient', async () => {
    mockUsda.mockResolvedValue(null);
    mockOff.mockResolvedValue(MOCK_RESULT);

    const { breakdown } = await NutritionEngine.analyze(['100g exotic mushroom']);

    expect(breakdown[0].source).toBe('openfoodfacts');
  });
});

// ─── Source chain — all sources exhausted ─────────────────────────────────────

describe('Source chain — FatSecret as final fallback', () => {
  it('uses FatSecret when USDA and OFF both fail', async () => {
    mockUsda.mockResolvedValue(null);
    mockOff.mockResolvedValue(null);
    mockFs.mockResolvedValue(MOCK_RESULT);

    const { breakdown } = await NutritionEngine.analyze(['100g wagyu beef']);

    expect(breakdown[0].source).toBe('fatsecret');
  });

  it('marks ingredient not_found when all three sources fail', async () => {
    mockUsda.mockResolvedValue(null);
    mockOff.mockResolvedValue(null);
    mockFs.mockResolvedValue(null);

    const { breakdown, total } = await NutritionEngine.analyze(['100g unobtainium powder']);

    expect(breakdown[0].status).toBe('not_found');
    expect(total.calories).toBe(0);
  });
});
