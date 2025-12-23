
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load env vars from the recipe-api root
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { supabase } from '../supabaseClient';
import { NutritionEngine } from '../services/nutritionEngine';

async function runAudit() {
  try {
    // 1. Fetch 10 recipes
    // We'll pick random ones or just the first 10.
    const { data: recipes, error } = await supabase
      .from('recipes')
      .select('*')
      .not('recipe_ingredients', 'is', null) // Ensure we have ingredients
      .limit(10);

    if (error) {
      console.error("Error fetching recipes:", error);
      process.exit(1);
    }

    if (!recipes || recipes.length === 0) {
      console.error("No recipes found.");
      process.exit(1);
    }

    const auditData = [];

    // 2. Analyze each recipe
    for (const recipe of recipes) {
      const ingredientsRaw = recipe.recipe_ingredients;
      let ingredients: string[] = [];

      if (Array.isArray(ingredientsRaw)) {
        ingredients = ingredientsRaw.map(i => typeof i === 'string' ? i : JSON.stringify(i));
      } else if (typeof ingredientsRaw === 'object' && ingredientsRaw !== null) {
          // Handle cases where it might be a JSON object, though typically it's an array of strings or objects
          // If it's the specific format stored by the crawler:
          // Sometimes it is stored as { "ingredient": "amount" } or similar.
          // Based on schema it is Json. Let's try to parse it safely.
          // If it's just a generic JSON object, we might need to inspect it. 
          // For now, let's assume it's an array of strings as per NutritionEngine expectation,
          // or convert what we can.
          ingredients = Object.values(ingredientsRaw).map(String);
      }

      if (ingredients.length === 0) continue;

      // Use NutritionEngine to calculate fresh (don't rely on stored nutrition)
      // This tests the current logic.
      const analysis = await NutritionEngine.analyze(ingredients);

      auditData.push({
        id: recipe.id,
        name: recipe.name,
        ingredients: ingredients,
        system_nutrition: {
          calories: analysis.total.calories,
          protein: analysis.total.protein,
          fat: analysis.total.fat,
          carbs: analysis.total.carbs
        }
      });
    }

    // 3. Output JSON
    console.log(JSON.stringify(auditData, null, 2));

  } catch (err) {
    console.error("Unexpected error:", err);
    process.exit(1);
  }
}

runAudit();
