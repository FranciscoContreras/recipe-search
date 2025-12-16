# Recipe Base - Project Context

## Project Overview

**Recipe Base** is a recipe management and analysis platform backend. It consists of a Node.js/Express API (`recipe-api`) and a Supabase database backend. The system is designed to crawl recipes from the web, store them, perform nutrition analysis, and serve them via a REST API.

### Key Technologies
- **Runtime:** Node.js
- **Language:** TypeScript
- **Framework:** Express.js
- **Database:** Supabase (PostgreSQL)
- **Crawling:** Playwright, Crawlee
- **Nutrition Analysis:** Custom `NutritionEngine`, FatSecret API
- **Deployment:** PM2 (ecosystem.config.js present)

## Directory Structure

### `recipe-api/`
The main backend application.
- **`src/index.ts`**: Application entry point. Defines Express routes and server setup.
- **`src/services/`**: Integration with external APIs and internal logic (FatSecret, USDA, NutritionEngine).
- **`src/crawler.ts`**: Logic for crawling recipe websites.
- **`src/worker.ts`**: Background worker entry point (likely for processing crawl jobs).
- **`public/`**: Static HTML files for admin, testing, and documentation interfaces.
- **`package.json`**: Dependencies and scripts.

### `supabase/`
Database configuration and migrations.
- **`migrations/`**: SQL files for schema changes.
- **`config.toml`**: Supabase configuration.

## Development Workflow

### Prerequisites
- Node.js (v20+ recommended)
- Supabase CLI (for local DB management, if applicable)
- Valid `.env` file in `recipe-api/` with Supabase credentials.

### Setup & Installation
```bash
cd recipe-api
npm install
```

### Running the Application
- **Development Mode:**
  ```bash
  npm run dev
  ```
  Runs the server with `nodemon` and `ts-node` for hot-reloading.

- **Production Build:**
  ```bash
  npm run build
  npm start
  ```
  Compiles TypeScript to `dist/` and runs the result.

### Testing
- Currently, no automated tests are defined in `package.json` (`npm test` exits with error).
- Manual testing can be done via the provided HTML pages in `recipe-api/public/` (e.g., `http://localhost:3000/lab.html`).

## Key API Endpoints
- **GET `/recipes`**: List recipes. Supports `?full=true` for full details.
- **GET `/recipes/:id`**: Get a single recipe. Performs JIT nutrition enrichment if missing.
- **GET `/search`**: Search recipes. Supports keyword (`q`) and ingredient (`ingredients`) filters.
- **POST `/crawl`**: Queue a new URL for crawling.
- **GET `/health`**: System health and statistics.

## Database Schema Highlights
- **`recipes`**: Stores recipe details (name, ingredients, instructions, nutrition).
- **`crawl_jobs`**: Manages the state of crawling tasks (pending, completed, failed).
- **RPC Functions**: Custom PostgreSQL functions used for complex queries like hybrid search (`search_recipes_hybrid`).

## Coding Conventions
- **TypeScript**: Strict typing is encouraged.
- **Async/Await**: Used for all database and network operations.
- **Environment Variables**: configuration via `dotenv`.
- **Supabase Client**: Singleton instance from `src/supabaseClient.ts`.

## Deployment Environment

- **Server:** VPS (`root@server.wearemachina.com`)
- **Domain:** `recipe-base.wearemachina.com`
- **Management:** CloudPanel