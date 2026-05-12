import { calculateScore } from '../utils/scoring';

const full = {
  name: 'Spaghetti Bolognese',
  description: 'A rich and hearty Italian meat sauce.',
  image: 'https://example.com/image.jpg',
  recipe_ingredients: ['400g pasta', '200g beef mince'],
  recipe_instructions: ['Boil water.', 'Cook pasta.', 'Add sauce.'],
  cook_time: 'PT30M',
  prep_time: 'PT10M',
  nutrition: { calories: '450 kcal' },
};

describe('calculateScore', () => {
  it('scores a complete recipe at 100', () => {
    expect(calculateScore(full)).toBe(100);
  });

  it('deducts 20 for missing image', () => {
    expect(calculateScore({ ...full, image: null })).toBe(80);
    expect(calculateScore({ ...full, image: '' })).toBe(80);
  });

  it('deducts 25 for missing ingredients', () => {
    expect(calculateScore({ ...full, recipe_ingredients: [] })).toBe(75);
    expect(calculateScore({ ...full, recipe_ingredients: null })).toBe(75);
  });

  it('deducts 25 for missing instructions', () => {
    expect(calculateScore({ ...full, recipe_instructions: [] })).toBe(75);
    expect(calculateScore({ ...full, recipe_instructions: null })).toBe(75);
  });

  it('deducts 10 for missing name (≤3 chars)', () => {
    expect(calculateScore({ ...full, name: '' })).toBe(90);
    expect(calculateScore({ ...full, name: 'Hi' })).toBe(90);
  });

  it('deducts 10 for missing description', () => {
    expect(calculateScore({ ...full, description: '' })).toBe(90);
    expect(calculateScore({ ...full, description: 'Short' })).toBe(90); // ≤10 chars
  });

  it('deducts 5 for missing timing', () => {
    expect(calculateScore({ ...full, cook_time: null, prep_time: null })).toBe(95);
  });

  it('deducts 5 for missing nutrition', () => {
    expect(calculateScore({ ...full, nutrition: null })).toBe(95);
  });

  it('scores a minimal viable recipe correctly', () => {
    // name + ingredients + instructions only
    const minimal = {
      name: 'Toast',
      description: null,
      image: null,
      recipe_ingredients: ['1 slice bread'],
      recipe_instructions: ['Toast bread.'],
      cook_time: null,
      prep_time: null,
      nutrition: null,
    };
    // 10 (name) + 25 (ingredients) + 25 (instructions) = 60
    expect(calculateScore(minimal)).toBe(60);
  });
});
