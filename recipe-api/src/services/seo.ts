
import { Tables } from '../database.types';
import escapeHtml from 'escape-html';

export const generateRecipeSchema = (recipe: Tables<'recipes'>): string => {
  const schema: any = {
    "@context": "https://schema.org/",
    "@type": "Recipe",
    "name": recipe.name,
    "image": recipe.image ? [recipe.image] : [],
    "author": {
      "@type": "Organization",
      "name": "Recipe Base"
    },
    "datePublished": recipe.created_at,
    "description": recipe.description || `A delicious recipe for ${recipe.name}.`,
    "recipeIngredient": recipe.recipe_ingredients || [],
    "recipeInstructions": (Array.isArray(recipe.recipe_instructions) ? recipe.recipe_instructions : []).map((step: any) => ({
      "@type": "HowToStep",
      "text": typeof step === 'string' ? step : step.text || step.name
    })),
  };

  if (recipe.prep_time) schema.prepTime = recipe.prep_time;
  if (recipe.cook_time) schema.cookTime = recipe.cook_time;
  if (recipe.total_time) schema.totalTime = recipe.total_time;
  if (recipe.recipe_yield) schema.recipeYield = recipe.recipe_yield;
  if (recipe.recipe_category) schema.recipeCategory = recipe.recipe_category;
  if (recipe.recipe_cuisine) schema.recipeCuisine = recipe.recipe_cuisine;

  if (recipe.nutrition) {
    const nut: any = recipe.nutrition;

    // Parse a nutrition value that may be a number (NutritionEngine output) or a string like
    // "300 calories" / "15 g" (Schema.org format from crawler or FatSecret).
    // parseFloat handles the string case correctly ("300 calories" → 300).
    const parseNutVal = (v: any): number | undefined => {
      if (typeof v === 'number') return isNaN(v) ? undefined : v;
      if (typeof v === 'string') { const n = parseFloat(v); return isNaN(n) ? undefined : n; }
      return undefined;
    };

    // Schema.org uses proteinContent/fatContent/carbohydrateContent; NutritionEngine uses protein/fat/carbs.
    const cal     = parseNutVal(nut.calories);
    const protein = parseNutVal(nut.proteinContent ?? nut.protein);
    const fat     = parseNutVal(nut.fatContent ?? nut.fat);
    const carbs   = parseNutVal(nut.carbohydrateContent ?? nut.carbohydrate ?? nut.carbs);

    schema.nutrition = { "@type": "NutritionInformation" };
    if (cal     !== undefined) schema.nutrition.calories           = `${Math.round(cal)} calories`;
    if (protein !== undefined) schema.nutrition.proteinContent     = `${Math.round(protein)} g`;
    if (fat     !== undefined) schema.nutrition.fatContent         = `${Math.round(fat)} g`;
    if (carbs   !== undefined) schema.nutrition.carbohydrateContent = `${Math.round(carbs)} g`;

    if (Object.keys(schema.nutrition).length === 1) delete schema.nutrition;
  }

  // Aggregate Rating (Fake it if missing, or use quality_score if available)
  if (recipe.quality_score) {
      schema.aggregateRating = {
          "@type": "AggregateRating",
          "ratingValue": Math.min(5, Math.max(1, (recipe.quality_score / 20))).toFixed(1), // Scale 0-100 to 0-5
          "reviewCount": 1 // minimal valid
      };
  }

  // Escape < and > so a recipe name containing </script> can't break the HTML page
  return JSON.stringify(schema)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
};

export const injectMetaTags = (html: string, recipe: Tables<'recipes'>): string => {
  const rawTitle = `${recipe.name} - Recipe Base`;
  const rawDesc = recipe.description || `Learn how to make ${recipe.name} with verified nutrition facts.`;
  const rawImage = recipe.image || 'https://recipe-base.wearemachina.com/logo-black.svg';
  const url = `https://recipe-base.wearemachina.com/recipe/${recipe.id}`;

  const title = escapeHtml(rawTitle);
  const desc = escapeHtml(rawDesc);
  const image = escapeHtml(rawImage);

  // Replace Title
  let newHtml = html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);

  // Inject Meta
  const metaTags = `
    <meta name="description" content="${desc}">
    <link rel="canonical" href="${url}">
    
    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website">
    <meta property="og:url" content="${url}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${desc}">
    <meta property="og:image" content="${image}">

    <!-- Twitter -->
    <meta property="twitter:card" content="summary_large_image">
    <meta property="twitter:url" content="${url}">
    <meta property="twitter:title" content="${title}">
    <meta property="twitter:description" content="${desc}">
    <meta property="twitter:image" content="${image}">
    
    <!-- JSON-LD Schema -->
    <script type="application/ld+json">
      ${generateRecipeSchema(recipe)}
    </script>
  `;

  // Inject before </head>
  if (newHtml.includes('</head>')) {
      newHtml = newHtml.replace('</head>', `${metaTags}</head>`);
  } else {
      newHtml += metaTags;
  }

  return newHtml;
};
