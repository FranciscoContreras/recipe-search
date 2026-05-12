import { cleanIngredientTerm, getSearchTerms } from '../utils/cleaning';

describe('cleanIngredientTerm', () => {
  it('returns empty string for empty input', () => {
    expect(cleanIngredientTerm('')).toBe('');
  });

  it('strips preparation words', () => {
    // Prep words removed; no USDA remapping — the core food name stays
    expect(cleanIngredientTerm('melted butter')).toBe('butter');
    expect(cleanIngredientTerm('chopped onions')).toBe('onions');
    expect(cleanIngredientTerm('finely diced carrots')).toBe('carrots');
    expect(cleanIngredientTerm('freshly ground black pepper')).toBe('ground black pepper'); // 'freshly' stripped, 'ground' kept (ambiguous)
  });

  it('removes content in parentheses', () => {
    expect(cleanIngredientTerm('sugar (about 200g)')).toBe('sugar');
    expect(cleanIngredientTerm('milk (whole, room temperature)')).toBe('milk');
  });

  it('removes digits', () => {
    expect(cleanIngredientTerm('1 cup rice')).toBe('rice');
    expect(cleanIngredientTerm('3 eggs')).toBe('eggs');
  });

  it('preserves the full ingredient name (no USDA-specific remapping)', () => {
    // These should come back as-is so the search engine handles disambiguation
    expect(cleanIngredientTerm('almond flour')).toBe('almond flour');    // NOT "flour wheat all-purpose"
    expect(cleanIngredientTerm('whole wheat pasta')).toBe('whole wheat pasta'); // NOT "pasta dry"
    expect(cleanIngredientTerm('coconut milk')).toBe('coconut milk');     // NOT "milk whole"
    expect(cleanIngredientTerm('tahini')).toBe('tahini');
    expect(cleanIngredientTerm('miso paste')).toBe('miso paste');
    expect(cleanIngredientTerm('nutritional yeast')).toBe('nutritional yeast');
  });

  it('applies ambiguity-only fixes', () => {
    // These fix search ambiguity where the generic name reliably matches the WRONG food
    expect(cleanIngredientTerm('grape tomatoes')).toBe('tomatoes');
    expect(cleanIngredientTerm('cherry tomatoes')).toBe('tomatoes');
    expect(cleanIngredientTerm('wheat berries')).toBe('wheat grain');
    expect(cleanIngredientTerm('scallions')).toBe('green onions');
    expect(cleanIngredientTerm('aubergine')).toBe('eggplant');
    expect(cleanIngredientTerm('courgette')).toBe('zucchini');
    expect(cleanIngredientTerm('coriander')).toBe('cilantro');   // British → American
  });

  it('collapses extra whitespace', () => {
    const result = cleanIngredientTerm('fresh   spinach');
    expect(result.trim()).toBe('spinach');           // "fresh" stripped, no remap
    expect(result).not.toMatch(/\s{2,}/);
  });

  it('lowercases the output', () => {
    const result = cleanIngredientTerm('CHICKEN BREAST');
    expect(result).toBe(result.toLowerCase());
  });
});

describe('getSearchTerms', () => {
  it('returns at least the cleaned term', () => {
    const terms = getSearchTerms('butter');
    expect(terms.length).toBeGreaterThan(0);
    expect(terms[0]).toBe('butter');
  });

  it('provides progressive fallback terms for multi-word ingredients', () => {
    const terms = getSearchTerms('almond flour');
    expect(terms).toContain('almond flour');
    expect(terms).toContain('flour');              // last word as fallback
  });

  it('provides three terms for three-word ingredients', () => {
    const terms = getSearchTerms('whole wheat pasta');
    expect(terms[0]).toBe('whole wheat pasta');
    expect(terms).toContain('wheat pasta');        // last two words
    expect(terms).toContain('pasta');              // last word
  });

  it('deduplicates terms', () => {
    const terms = getSearchTerms('tahini');
    const unique = new Set(terms);
    expect(terms.length).toBe(unique.size);
  });

  it('handles ambiguity-fixed terms', () => {
    const terms = getSearchTerms('grape tomatoes');
    expect(terms[0]).toBe('tomatoes');             // ambiguity fix applied first
  });

  it('returns empty array for empty input', () => {
    expect(getSearchTerms('')).toEqual([]);
  });
});
