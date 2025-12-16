export function calculateScore(recipe: any): number {
    let score = 0;
    if (recipe.name && recipe.name.length > 3) score += 10;
    if (recipe.description && recipe.description.length > 10) score += 10;
    if (recipe.image && recipe.image.length > 10) score += 20;
    if (Array.isArray(recipe.recipe_ingredients) && recipe.recipe_ingredients.length > 0) score += 25;
    if (Array.isArray(recipe.recipe_instructions) && recipe.recipe_instructions.length > 0) score += 25;
    if (recipe.cook_time || recipe.prep_time) score += 5;
    if (recipe.nutrition) score += 5;
    return score;
}
