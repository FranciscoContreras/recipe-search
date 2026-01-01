# Recipe Base API

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen.svg)](https://recipe-base.wearemachina.com)
![Status](https://img.shields.io/badge/status-proprietary-red.svg)
![Node.js](https://img.shields.io/badge/node->=20.0.0-green.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.0-blue.svg)
![Supabase](https://img.shields.io/badge/supabase-postgres-green.svg)

**Recipe Base** is a high-performance backend platform designed for the intelligent aggregation, analysis, and retrieval of culinary data. It combines a robust web crawler, a custom nutrition analysis engine, and a hybrid search system to deliver enriched recipe data via a RESTful API.

**Live URL:** [https://recipe-base.wearemachina.com](https://recipe-base.wearemachina.com)

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

## 📖 API Capabilities

The API adheres to the OpenAPI 3.0 standard. Key capabilities include:

| Feature | Description |
|:---|:---|
| **Recipe Retrieval** | High-speed pagination and filtering of recipe datasets. |
| **Hybrid Search** | Combines keyword matching with vector-based semantic search for "vibe-based" queries. |
| **Nutrition Engine** | Proprietary algorithm for parsing natural language ingredient lists into structured nutritional data. |
| **Crawler Queue** | Asynchronous job queue for indexing new domains on demand. |
| **Secure Auth** | Self-service API key generation with email verification and rotation logic. |

## 🛡️ Security Measures

- **Authentication:** `x-api-key` header enforcement for all protected routes.
- **Rate Limiting:** 
  - Global: 300 requests / 15 mins.
  - Auth: 5 requests / 1 hour.
- **Sanitization:** Strict input validation and XSS protection on all public-facing renders.

## 🔒 Access & Licensing

**© 2026 Francisco Contreras. All Rights Reserved.**

This repository contains proprietary source code and is intended for portfolio and demonstration purposes only. Unauthorized copying, modification, distribution, or use of this software is strictly prohibited.