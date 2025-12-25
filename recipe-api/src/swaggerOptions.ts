import { Options } from 'swagger-jsdoc';

export const swaggerOptions: Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Recipe Base API',
      version: '1.2.0',
      description: 'The infrastructure for culinary data. Parse unstructured recipes, normalize units, and enrich ingredients with USDA-verified nutrition.',
      contact: {
        name: 'Recipe Base Support',
        url: 'https://recipe-base.wearemachina.com',
        email: 'support@wearemachina.com'
      },
    },
    servers: [
      {
        url: 'https://recipe-base.wearemachina.com',
        description: 'Production Server'
      },
      {
        url: 'http://localhost:3000',
        description: 'Development Server'
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key'
        }
      },
      schemas: {
        Recipe: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            description: { type: 'string' },
            image: { type: 'string', format: 'uri' },
            prep_time: { type: 'string', example: 'PT15M' },
            cook_time: { type: 'string', example: 'PT1H' },
            recipe_yield: { type: 'string' },
            recipe_ingredients: { type: 'array', items: { type: 'string' } },
            recipe_instructions: { 
              type: 'array', 
              items: { 
                oneOf: [
                  { type: 'string' },
                  { type: 'object', properties: { text: { type: 'string' } } }
                ] 
              } 
            },
            nutrition: {
              type: 'object',
              properties: {
                calories: { type: 'number' },
                protein: { type: 'number' },
                fat: { type: 'number' },
                carbohydrate: { type: 'number' }
              }
            }
          }
        },
        NutritionAnalysis: {
          type: 'object',
          properties: {
            total: {
              type: 'object',
              properties: {
                calories: { type: 'number' },
                protein: { type: 'number' },
                fat: { type: 'number' },
                carbohydrate: { type: 'number' }
              }
            },
            breakdown: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  stats: { type: 'object' }
                }
              }
            }
          }
        }
      }
    },
    security: [
      {
        ApiKeyAuth: []
      }
    ]
  },
  apis: ['./src/index.ts', './src/controllers/*.ts'], // Path to the API docs
};
