import { normalizeUrl } from '../crawler';

describe('normalizeUrl', () => {
  it('strips query parameters', () => {
    expect(normalizeUrl('https://example.com/recipe?utm_source=google'))
      .toBe('https://example.com/recipe');
    expect(normalizeUrl('https://example.com/pasta?servings=4&print=true'))
      .toBe('https://example.com/pasta');
  });

  it('strips URL fragments', () => {
    expect(normalizeUrl('https://example.com/recipe#comments'))
      .toBe('https://example.com/recipe');
  });

  it('strips both query params and fragments', () => {
    expect(normalizeUrl('https://example.com/recipe?ref=home#top'))
      .toBe('https://example.com/recipe');
  });

  it('removes trailing slash', () => {
    expect(normalizeUrl('https://example.com/recipe/'))
      .toBe('https://example.com/recipe');
  });

  it('preserves the path', () => {
    expect(normalizeUrl('https://www.seriouseats.com/best-pasta-bolognese-recipe'))
      .toBe('https://www.seriouseats.com/best-pasta-bolognese-recipe');
  });

  it('returns the original string unchanged for an invalid URL', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url');
  });

  it('handles root URLs', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
  });
});
