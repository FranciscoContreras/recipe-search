export function cleanIngredientTerm(term: string): string {
    if (!term) return '';
    
    let cleaned = term.toLowerCase();

    // Remove preparation states that confuse search
    const prepWords = [
        'melted', 'softened', 'chopped', 'sliced', 'diced', 'minced', 
        'crushed', 'beaten', 'sifted', 'warm', 'cold', 'hot', 'boiling',
        'room temperature', 'granulated', 'all-purpose', 'all purpose',
        'dried', 'raw', 'cooked', 'steamed', 'baked', 'fried', 'grilled' 
        // Note: 'raw'/'cooked' removal might be controversial, but usually we want the base food match 
        // and let the API decide or use "raw" if implicitly needed. 
        // Actually, removing "all-purpose" helps find generic "flour".
    ];

    // Remove punctuation (replace with space to avoid word merging)
    cleaned = cleaned.replace(/[.,\/#!$%\^&*;:{}=\-_`~()]/g, ' ');

    // Remove words
    for (const word of prepWords) {
        // Remove word if it's surrounded by spaces or start/end of string
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        cleaned = cleaned.replace(regex, '');
    }

    // Collapse spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // Specific Mappings for Better Matches
    const mappings: Record<string, string> = {
        'milk': 'milk whole',
        'egg': 'egg whole',
        'eggs': 'egg whole',
        'flour': 'flour wheat all-purpose',
        'sugar': 'sugar granulated',
        'butter': 'butter salted',
        'rice': 'rice white raw',
        'white rice': 'rice white raw', // Specific for "white rice"
        'oats': 'oats rolled raw',
        'rolled oats': 'oats rolled raw', // Specific for "rolled oats"
        'pasta': 'pasta dry'
    };

    if (mappings[cleaned]) {
        return mappings[cleaned];
    }

    return cleaned;
}
