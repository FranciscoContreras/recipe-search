# Nutrition Engine Audit Report
**Date:** December 22, 2025
**Auditor:** Gemini Agent

## Executive Summary
An audit of the `recipe-api`'s `NutritionEngine` was conducted to verify its accuracy in extracting, parsing, and analyzing nutritional data from recipe ingredients. Due to connectivity issues with the local database, a standalone test harness was created using 10 representative mock recipes.

**Overall Status:** 🔴 **CRITICAL ISSUES FOUND**
The system is operationally functional (connects to APIs, parses text) but suffers from **significant accuracy logic flaws** that render nutritional counts unreliable (error margins >50% in common cases).

## Methodology
1.  **Code Analysis:** Reviewed `NutritionEngine`, `usda.ts`, and `fatsecret.ts`.
2.  **Standalone Simulation:** Created `src/scripts/standalone_audit.ts` to bypass DB dependencies and test the core analysis logic against 10 mock recipes.
3.  **Online Verification:** Compared system output against verified online nutritional data (USDA/Google) for key ingredients.

## Key Findings

### 1. ❌ Critical Density Assumption Error (Volume-to-Weight)
The system assumes the density of **water** (1 cup = 236g) for *all* volume measurements.
*   **Impact:** Dry ingredients are massively overestimated.
*   **Example:** "1.5 cups flour" was calculated as **354g** (1296 kcal).
    *   *Actual:* 1.5 cups flour ≈ **188g** (~680 kcal).
    *   *Error:* **+90% Overestimation**.
*   **Code Location:** `NutritionEngine.unitToGrams` applies `qty * 236` for 'cup' regardless of the ingredient.

### 2. ❌ Quantity Logic Failure (Implicit Units)
When an ingredient has a quantity but no explicit unit (e.g., "2 chicken breasts"), the system defaults to a fixed weight (100g) and **ignores the quantity**.
*   **Impact:** Scaling recipes (e.g., "4 eggs") results in the nutrition of a single item or a fixed 100g block.
*   **Example:** "2 chicken breasts" was analyzed as **100g** total (106 kcal).
    *   *Actual:* ~400g (~440 kcal).
    *   *Error:* **-75% Underestimation**.
*   **Code Location:** `NutritionEngine.analyze` regex fallback logic does not multiply the default weight by `qty`.

### 3. ⚠️ Search Matching Accuracy
The USDA/FatSecret search terms often yield irrelevant results due to lack of strict filtering or category handling.
*   **Example 1:** "Butter melted" matched **"Baby Toddler yogurt melts"** (USDA).
*   **Example 2:** "White rice" matched **"Beans and white rice"** (USDA).
*   **Impact:** Unpredictable nutritional profiles for common ingredients.

## Detailed Comparison (Sample)

| Recipe Item | System Result | Online Verified | Variance | Root Cause |
| :--- | :--- | :--- | :--- | :--- |
| **Fluffy Pancakes (Total)** | **1636 kcal** | **~1000 kcal** | **+63%** | Flour density (water assumption). |
| 1.5 cups Flour | 1296 kcal | ~680 kcal | +90% | Density assumption. |
| 3 tbsp Butter | 171 kcal | ~305 kcal | -44% | Matched "Yogurt Melts". |
| **Grilled Chicken** | **285 kcal** | **~600 kcal** | **-52%** | Quantity ignored. |
| 2 Chicken Breasts | 106 kcal | ~440 kcal | -75% | `2` ignored, default 100g used. |
| **Steamed Rice** | **406 kcal** | **~700 kcal** | **-42%** | Source mismatch. |
| 1 cup Rice | 387 kcal | ~680 kcal | -43% | Matched "Beans & Rice" (cooked/mixed). |

## Recommendations

1.  **Implement Density Library:** Replace `unitToGrams` with a library that handles density (e.g., `convert-units` combined with a density map for common ingredients like flour, sugar, oats).
2.  **Fix Quantity Multiplier:** Ensure the default weight logic multiplies by the parsed quantity (`return 100 * qty`).
3.  **Improve Search Queries:**
    *   Strip preparation verbs ("melted", "diced") before searching.
    *   Filter USDA results to exclude "Babyfood", "Branded", or specific categories if the match isn't exact.
    *   Prioritize "Raw" or "Unprepared" matches for base ingredients.
4.  **Database:** Fix the missing/invalid `SUPABASE_URL` in `.env` to enable real-world testing and caching.

## Artifacts
*   **Audit Script:** `recipe-api/src/scripts/standalone_audit.ts`
*   **Output Log:** `audit_output.json`
