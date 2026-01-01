# Recipe Base - Project Context

## Recent Updates (Last 2 Weeks)
- **Security:** Implemented comprehensive security hardening including global rate limiting (300 req/15m), strict auth rate limiting (5 req/h), XSS protection via `escape-html`, and HTTP header security with `helmet`.
- **UI/UX:** Major overhaul of the "Ceramic" design system. Added a dynamic 3D "Engine Grid" background, refined "God Rays" shader with desktop-only fade-in, and optimized mobile responsiveness for all pages.
- **Documentation:** Integrated Swagger/OpenAPI documentation at `/api-docs`. Added a detailed "Case Study" page.
- **Nutrition Engine:** Improved accuracy with density-based unit conversion, better ingredient cleaning, and JIT (Just-In-Time) non-blocking nutrition enrichment for recipes.
- **Auth:** Implemented self-service API key request portal with email delivery (Resend) and key rotation logic.

## Project Overview

**Recipe Base** is a recipe management and analysis platform backend. It consists of a Node.js/Express API (`recipe-api`) and a Supabase database backend. The system is designed to crawl recipes from the web, store them, perform nutrition analysis, and serve them via a REST API.

### Key Technologies
- **Runtime:** Node.js
- **Language:** TypeScript
- **Framework:** Express.js
- **Database:** Supabase (PostgreSQL)
- **Security:** Helmet, Express Rate Limit, Custom API Key Auth
- **Crawling:** Playwright, Crawlee
- **Nutrition Analysis:** Custom `NutritionEngine`, FatSecret API
- **Documentation:** Swagger UI / OpenAPI
- **Frontend Design:** "Ceramic" Design System (Tailwind, Three.js shaders, Lucide Icons)
- **Deployment:** PM2 (ecosystem.config.js present)

## Directory Structure

### `recipe-api/`
The main backend application.
- **`src/index.ts`**: Application entry point. Defines Express routes and server setup.
- **`src/middleware/auth.ts`**: API Key authentication middleware.
- **`src/controllers/authController.ts`**: Logic for generating and emailing API keys.
- **`src/services/`**: Integration with external APIs and internal logic (FatSecret, USDA, NutritionEngine, Email).
- **`src/crawler.ts`**: Logic for crawling recipe websites.
- **`public/`**: Static HTML files for the frontend interface.
    - **`index.html`**: Landing page with live analysis demo.
    - **`access.html`**: Portal to request API keys.
    - **`lab.html`**: Interactive API playground.
    - **`docs.html`**: API documentation landing page.
    - **`admin.html`**: Crawler management interface.
    - **`case-study.html`**: Project backstory and technical showcase.

### `supabase/`
Database configuration and migrations.
- **`migrations/`**: SQL files for schema changes.
- **`config.toml`**: Supabase configuration.

## Development Workflow

### Prerequisites
- Node.js (v20+ recommended)
- Supabase CLI (for local DB management, if applicable)
- Valid `.env` file in `recipe-api/` with Supabase credentials and Mailgun/SMTP settings.

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

## API Authentication
All endpoints (except `/health`, `/`, `/auth/request-key`, and `/api-docs`) require an API Key.
- **Header:** `x-api-key: <YOUR_KEY>`
- **Rate Limits:** 
    - Global: 300 requests / 15 min per IP.
    - Key Request: 5 requests / 1 hour per IP.
- **Requesting Keys:** POST `/auth/request-key` with `{ "email": "..." }`.
- **Logic:** Emails are normalized (aliases removed) and existing keys are rotated/overwritten to prevent abuse.

## Key API Endpoints
- **GET `/api-docs`**: Interactive Swagger/OpenAPI documentation.
- **GET `/recipes`**: List recipes. Supports `?full=true`. (Auth Required)
- **GET `/recipes/:id`**: Get a single recipe. Performs JIT nutrition enrichment. (Auth Required)
- **GET `/search`**: Search recipes via hybrid vector/text search. (Auth Required)
- **POST `/nutrition/analyze`**: Analyze raw ingredient text. (Auth Required)
- **POST `/crawl`**: Queue a new URL for crawling. (Auth Required)
- **POST `/auth/request-key`**: Request a new API key via email. (Public)
- **GET `/health`**: System health and statistics. (Public)

## Database Schema Highlights
- **`recipes`**: Stores recipe details, nutrition, and embeddings.
- **`crawl_jobs`**: Manages the state of crawling tasks.
- **`api_keys`**: Stores hashed API keys and owner information.
- **RPC Functions**: 
    - `search_recipes_hybrid`: Semantic + Keyword search.
    - `update_recipe_nutritions`: Batch updates.

## Design System ("Ceramic")
The frontend uses a custom design system characterized by:
- **Colors:** Deep Green (`#1a4432`) primary, Off-white (`#fafafa`) background.
- **Typography:** `Grenda` (Display), `DM Sans` (UI), `JetBrains Mono` (Code).
- **Visuals:** 
    - **"God Rays"**: Three.js background shader with mouse interaction (Desktop only).
    - **"Engine Grid"**: 3D floating grid animation for technical pages.
    - Lucide icons for UI elements.
- **Components:** `card-ceramic`, `btn-primary`, `input-ceramic`.

## Deployment Environment
- **Server:** VPS (`root@server.wearemachina.com`)
- **Domain:** `recipe-base.wearemachina.com`
- **Management:** CloudPanel
