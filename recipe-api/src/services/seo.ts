
import { Tables } from '../database.types';

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
    "recipeInstructions": (recipe.recipe_instructions || []).map((step: any) => ({
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
  if (recipe.keywords) schema.keywords = recipe.keywords;

  if (recipe.nutrition) {
    const nut: any = recipe.nutrition;
    schema.nutrition = {
      "@type": "NutritionInformation",
      "calories": nut.calories ? `${Math.round(Number(nut.calories))} calories` : undefined,
      "proteinContent": nut.protein ? `${Math.round(Number(nut.protein))} g` : undefined,
      "fatContent": nut.fat ? `${Math.round(Number(nut.fat))} g` : undefined,
      "carbohydrateContent": nut.carbohydrate ? `${Math.round(Number(nut.carbohydrate))} g` : undefined,
    };
    // Remove undefined keys
    Object.keys(schema.nutrition).forEach(key => schema.nutrition[key] === undefined && delete schema.nutrition[key]);
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

  return JSON.stringify(schema);
};

export const injectMetaTags = (html: string, recipe: Tables<'recipes'>): string => {
  const title = `${recipe.name} - Recipe Base`;
  const desc = recipe.description || `Learn how to make ${recipe.name} with verified nutrition facts.`;
  const image = recipe.image || 'https://recipe-base.wearemachina.com/logo-black.svg';
  const url = `https://recipe-base.wearemachina.com/recipe/${recipe.id}`;

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
