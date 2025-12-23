import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Ensure env is loaded
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { NutritionEngine } from '../services/nutritionEngine';

// Mock Recipes
const mockRecipes = [
    { id: '1', name: 'Fluffy Pancakes', ingredients: ['1 1/2 cups all-purpose flour', '3 1/2 tsp baking powder', '1 tsp salt', '1 tbsp white sugar', '1 1/4 cups milk', '1 egg', '3 tbsp butter melted'] },
    { id: '2', name: 'Scrambled Eggs', ingredients: ['4 eggs', '1/4 cup milk', '1 tsp salt', '1 tbsp butter'] },
    { id: '3', name: 'Oatmeal', ingredients: ['1/2 cup rolled oats', '1 cup water', '1 tsp brown sugar', '1 pinch salt'] },
    { id: '4', name: 'Grilled Chicken', ingredients: ['2 chicken breasts', '1 tbsp olive oil', '1 tsp salt', '1/2 tsp black pepper'] },
    { id: '5', name: 'Steamed Rice', ingredients: ['1 cup white rice', '2 cups water', '1/2 tsp salt'] },
    { id: '6', name: 'Fruit Salad', ingredients: ['1 apple', '1 banana', '1 cup grapes', '1 cup strawberries'] },
    { id: '7', name: 'Peanut Butter Sandwich', ingredients: ['2 slices wheat bread', '2 tbsp peanut butter', '1 tbsp jelly'] },
    { id: '8', name: 'Pasta with Tomato Sauce', ingredients: ['200g pasta', '1 cup tomato sauce', '1 tbsp parmesan cheese'] },
    { id: '9', name: 'Green Smoothie', ingredients: ['1 cup spinach', '1 banana', '1 cup almond milk'] },
    { id: '10', name: 'Basic Salad', ingredients: ['2 cups lettuce', '1 tomato', '1 cucumber', '1 tbsp olive oil'] }
];

async function run() {
    console.log("Running audit with UPDATED NutritionEngine...");
    const results = [];
    for (const recipe of mockRecipes) {
        console.error(`Analyzing ${recipe.name}...`);
        const analysis = await NutritionEngine.analyze(recipe.ingredients);
        results.push({
            id: recipe.id,
            name: recipe.name,
            ingredients: recipe.ingredients,
            system_nutrition: {
                calories: analysis.total.calories,
                protein: analysis.total.protein,
                fat: analysis.total.fat,
                carbs: analysis.total.carbs
            },
            breakdown: analysis.breakdown
        });
    }
    console.log(JSON.stringify(results, null, 2));
}

run();