export function cleanIngredientTerm(term: string): string {
    if (!term) return '';
    
    let cleaned = term.toLowerCase();

    // Remove content in parentheses (often quantity info or alternates that confuse search)
    // e.g. "1 cup (about 200g) sugar" -> "1 cup sugar"
    cleaned = cleaned.replace(/\([^)]*\)/g, ' ');

    // Remove preparation states and noise words that confuse search
    const prepWords = [
        // Prep methods
        'melted', 'softened', 'chopped', 'sliced', 'diced', 'minced', 
        'crushed', 'beaten', 'sifted', 'warm', 'cold', 'hot', 'boiling',
        'room temperature', 'granulated', 'all-purpose', 'all purpose',
        'dried', 'raw', 'cooked', 'steamed', 'baked', 'fried', 'grilled',
        'presoaked', 'soaked', 'drained', 'rinsed', 'peeled', 'cored', 
        'seeded', 'halved', 'quartered', 'cubed', 'grated', 'shredded',
        'mashed', 'pureed', 'julienned', 'toasted', 'roasted',
        // Cuts/Shapes
        'lengthwise', 'crosswise', 'thinly', 'thickly', 'finely', 
        'coarsely', 'roughly', 'boneless', 'skinless',
        // State/Condition
        'packed', 'tightly', 'loosely', 'divided', 'separated', 
        'reserved', 'removed', 'discarded', 'pitted',
        // Adjectives/Types that often confuse fuzzy search
        'fresh', 'frozen', 'canned', // controversial but often safer for generic match
        'flat-leaf', 'flat leaf', 'curly',
        'heirloom', 'baby', 'extra virgin', 'virgin',
        // Quantity/Instruction noise
        'about', 'plus', 'more', 'garnish', 'taste', 'serving',
        'pinch', 'dash', 'handful', 'bunch',
        'hours', 'minutes', 'overnight', 'possible', 'needed', 'necessary',
        // Conjunctions/Prepositions
        'for', 'and', 'with', 'in', 'to', 'of', 'or', 'then', 'if',
        // Number words (often part of instructions like "divided into two")
        'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
        // Units (if parsing failed, these might remain)
        'cup', 'cups', 'tbsp', 'tablespoon', 'tsp', 'teaspoon', 'pint', 'quart', 
        'gallon', 'oz', 'ounce', 'gram', 'lb', 'pound', 'kg', 'liter', 'ml'
    ];

    // Remove punctuation (replace with space to avoid word merging)
    cleaned = cleaned.replace(/[.,\/#!$%\^&*;:{}=\-_`~]/g, ' ');

    // Remove digits
    cleaned = cleaned.replace(/[0-9]/g, ' ');

    // Remove words
    for (const word of prepWords) {
        // Remove word if it's surrounded by spaces or start/end of string
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        cleaned = cleaned.replace(regex, '');
    }

    // Collapse spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // Specific Mappings/Corrections for USDA Search
    // These help map culinary terms to the specific naming conventions used in the database
    // or fix issues where multi-word terms (e.g. "grape tomatoes") match the wrong noun (e.g. "grape juice")
    const termCorrections: Record<string, string> = {
        'milk': 'milk whole',
        'egg': 'egg whole',
        'eggs': 'egg whole',
        'flour': 'flour wheat all-purpose',
        'sugar': 'sugar granulated',
        'butter': 'butter salted',
        'rice': 'rice white raw',
        'white rice': 'rice white raw', 
        'oats': 'oats rolled raw',
        'rolled oats': 'oats rolled raw',
        'pasta': 'pasta dry',
        'bread': 'bread white',
        'oil': 'oil vegetable',
        
        // Fixes for specific search ambiguity
        'grape tomatoes': 'tomatoes', // Fixes match to "Grape Juice"
        'cherry tomatoes': 'tomatoes',
        'wheat berries': 'wheat grain', // Fixes match to generic "Berries"
        'scallions': 'onions spring',
        'baby spinach': 'spinach',
        
        // Herb normalization
        'mint leaves': 'mint fresh',
        'parsley leaves': 'parsley fresh',
        'cilantro leaves': 'cilantro fresh',
        'basil leaves': 'basil fresh'
    };

    if (termCorrections[cleaned]) {
        return termCorrections[cleaned];
    }

    return cleaned;
}
