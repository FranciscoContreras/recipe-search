# Recipe Base API

![License](https://img.shields.io/badge/license-ISC-blue.svg)
![Node.js](https://img.shields.io/badge/node->=20.0.0-green.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.0-blue.svg)
![Supabase](https://img.shields.io/badge/supabase-postgres-green.svg)

**Recipe Base** is a high-performance backend platform designed for the intelligent aggregation, analysis, and retrieval of culinary data. It combines a robust web crawler, a custom nutrition analysis engine, and a hybrid search system to deliver enriched recipe data via a RESTful API.

Maintained by [Francisco Contreras](https://contrerasfrancisco.com).

## 🚀 Overview

This project serves as the backbone for a modern recipe search engine. Unlike standard recipe APIs that rely on static databases, Recipe Base dynamically enriches content using:
- **JIT Nutrition Analysis:** Real-time parsing of ingredient lines to calculate macros (calories, protein, fat, etc.) using a custom density-aware engine.
- **Hybrid Search:** Leveraging Supabase's `pgvector` for semantic similarity alongside traditional full-text search for high-relevance results.
- **Automated Crawling:** A resilient crawler (Playwright + Crawlee) that navigates recipe sites, handling DOM parsing and normalization.

## 🛠️ Architecture

The system is built on a microservices-lite architecture using Node.js and Express.

- **API Layer:** Express.js with strict type safety (TypeScript).
- **Data Layer:** Supabase (PostgreSQL) for relational data and vector embeddings.
- **Worker Layer:** Background workers for crawling tasks and heavy nutrition computation.
- **Security:** Custom API Key authentication, global rate limiting, and Helmet-hardened headers.

## 📦 Tech Stack

- **Runtime:** Node.js (v20+)
- **Framework:** Express.js
- **Database:** PostgreSQL (via Supabase)
- **Crawling:** Crawlee, Playwright
- **Validation:** Custom middleware & sanitization
- **Docs:** Swagger / OpenAPI 3.0

## ⚡ Quick Start

### Prerequisites
- Node.js 20.x or higher
- A Supabase project (or local instance)
- SMTP credentials (for API key delivery)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/FranciscoContreras/recipe-search.git
   cd recipe-search/recipe-api
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment**
   Create a `.env` file in `recipe-api/` with the following:
   ```env
   PORT=3000
   SUPABASE_URL=your_supabase_url
   SUPABASE_ANON_KEY=your_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```

4. **Run Development Server**
   ```bash
   npm run dev
   ```

## 📖 API Documentation

The API is fully documented using OpenAPI 3.0 standard.

- **Interactive Docs:** Visit `http://localhost:3000/api-docs` after starting the server.
- **Health Check:** `GET /health` (Public)

### Key Endpoints

| Method | Endpoint | Description | Auth |
|:---|:---|:---|:---|
| `GET` | `/recipes` | List recipes with pagination. | 🔒 |
| `GET` | `/search` | Hybrid search (Text + Semantic). | 🔒 |
| `POST` | `/nutrition/analyze` | Parse raw ingredients to macros. | 🔒 |
| `POST` | `/crawl` | Queue a URL for indexing. | 🔒 |
| `POST` | `/auth/request-key` | Request an API key via email. | 🌍 |

## 🛡️ Security

- **Authentication:** `x-api-key` header required for protected routes.
- **Rate Limiting:** 
  - Global: 300 requests / 15 mins.
  - Auth: 5 requests / 1 hour.
- **Sanitization:** Input validation and XSS protection on all public-facing renders.

## 🤝 Contributing

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'feat: Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

Distributed under the ISC License. See `LICENSE` for more information.
