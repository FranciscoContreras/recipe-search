/**
 * Embeddings — provider-agnostic interface so the app can swap from OpenAI to
 * Google, Voyage, Cohere, Ollama, etc. without touching call sites.
 *
 * Default provider: OpenAI text-embedding-3-small (1536 dims). Cheap (~$0.02
 * per million tokens — backfilling our 23K recipes costs roughly one cent).
 *
 * Required env (depending on provider):
 *   OPENAI_API_KEY  — sk-... from https://platform.openai.com/api-keys
 *   GOOGLE_API_KEY  — AIza... from https://aistudio.google.com/apikey
 *
 * Optional env:
 *   EMBEDDING_PROVIDER=openai|google|ollama    (default: openai)
 *   EMBEDDING_MODEL=text-embedding-3-small     (provider-specific default if unset)
 *   EMBEDDING_DIMENSIONS=1536                   (must match the migration's vector(N))
 *
 * Switching providers WITHIN the same dimensionality (e.g. 1536) is free —
 * just change EMBEDDING_PROVIDER and re-backfill. Switching dims requires
 * an ALTER TABLE recipes ALTER COLUMN embedding TYPE vector(NEW_DIMS).
 */

export interface EmbeddingProvider {
    readonly name:       string;
    readonly model:      string;
    readonly dimensions: number;
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
}

// ─── OpenAI provider ─────────────────────────────────────────────────────────

class OpenAIEmbedding implements EmbeddingProvider {
    readonly name       = 'openai';
    readonly model:      string;
    readonly dimensions: number;
    private readonly apiKey: string;

    constructor(apiKey: string, model = 'text-embedding-3-small', dimensions = 1536) {
        this.apiKey     = apiKey;
        this.model      = model;
        this.dimensions = dimensions;
    }

    async embed(text: string): Promise<number[]> {
        const out = await this.embedBatch([text]);
        return out[0];
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];
        // OpenAI accepts up to 2048 inputs per call; keep batches smaller so
        // a single failure doesn't waste a lot of API time.
        const body = {
            input:           texts,
            model:           this.model,
            // text-embedding-3-* supports the `dimensions` knob; the smaller
            // models below 1536 trade quality for cost. Default 1536 is the
            // native output dimension for -small.
            ...(this.model.startsWith('text-embedding-3-') ? { dimensions: this.dimensions } : {}),
        };
        const res = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const detail = await res.text();
            throw new Error(`OpenAI embeddings ${res.status}: ${detail.slice(0, 500)}`);
        }
        const json = await res.json() as { data: { embedding: number[]; index: number }[] };
        // The API guarantees same order, but be paranoid:
        return json.data
            .sort((a, b) => a.index - b.index)
            .map((row) => row.embedding);
    }
}

// ─── Google (Gemini) provider ────────────────────────────────────────────────

class GoogleEmbedding implements EmbeddingProvider {
    readonly name       = 'google';
    readonly model:      string;
    readonly dimensions: number;
    private readonly apiKey: string;

    constructor(apiKey: string, model = 'gemini-embedding-001', dimensions = 1536) {
        this.apiKey     = apiKey;
        this.model      = model;
        this.dimensions = dimensions;
    }

    async embed(text: string): Promise<number[]> {
        const out = await this.embedBatch([text]);
        return out[0];
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];
        // batchEmbedContents accepts up to 100 requests per call.
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents?key=${this.apiKey}`;
        const body = {
            requests: texts.map((t) => ({
                model:                `models/${this.model}`,
                content:              { parts: [{ text: t }] },
                outputDimensionality: this.dimensions,
            })),
        };
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
        });
        if (!res.ok) {
            const detail = await res.text();
            throw new Error(`Google embeddings ${res.status}: ${detail.slice(0, 500)}`);
        }
        const json = await res.json() as { embeddings: { values: number[] }[] };
        return json.embeddings.map((e) => e.values);
    }
}

// ─── Provider selector ───────────────────────────────────────────────────────

let cachedProvider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
    if (cachedProvider) return cachedProvider;

    const which = (process.env.EMBEDDING_PROVIDER ?? 'openai').toLowerCase();

    if (which === 'openai') {
        const key = process.env.OPENAI_API_KEY;
        if (!key) {
            throw new Error(
                'OPENAI_API_KEY is required for the openai embedding provider. ' +
                'Set it in recipe-api/.env, or pick a different EMBEDDING_PROVIDER.',
            );
        }
        const model = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';
        const dims  = process.env.EMBEDDING_DIMENSIONS ? parseInt(process.env.EMBEDDING_DIMENSIONS, 10) : 1536;
        cachedProvider = new OpenAIEmbedding(key, model, dims);
        return cachedProvider;
    }

    if (which === 'google' || which === 'gemini') {
        const key = process.env.GOOGLE_API_KEY;
        if (!key) {
            throw new Error(
                'GOOGLE_API_KEY is required for the google embedding provider. ' +
                'Get one at https://aistudio.google.com/apikey, set it in recipe-api/.env.',
            );
        }
        const model = process.env.EMBEDDING_MODEL ?? 'gemini-embedding-001';
        const dims  = process.env.EMBEDDING_DIMENSIONS ? parseInt(process.env.EMBEDDING_DIMENSIONS, 10) : 1536;
        cachedProvider = new GoogleEmbedding(key, model, dims);
        return cachedProvider;
    }

    // Future providers (voyage, cohere, ollama) plug in here.
    throw new Error(`Unknown EMBEDDING_PROVIDER='${which}'. Supported: openai, google.`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build the text we feed to the embedder for a recipe row. Keep this
 * deterministic — if you change it, every embedding becomes stale and the
 * backfill must re-run from scratch.
 */
export function recipeEmbeddingText(recipe: {
    name:                string;
    description?:        string | null;
    recipe_ingredients?: unknown;  // jsonb
    recipe_category?:    string | null;
    recipe_cuisine?:     string | null;
}): string {
    const parts: string[] = [recipe.name];
    if (recipe.description)     parts.push(recipe.description);
    if (recipe.recipe_category) parts.push(`Category: ${recipe.recipe_category}`);
    if (recipe.recipe_cuisine)  parts.push(`Cuisine: ${recipe.recipe_cuisine}`);
    if (Array.isArray(recipe.recipe_ingredients)) {
        parts.push('Ingredients: ' + recipe.recipe_ingredients
            .filter((x): x is string => typeof x === 'string')
            .slice(0, 50)
            .join('; '));
    }
    return parts.join('. ').slice(0, 8000);  // OpenAI text-embedding-3 limit is 8191 tokens
}

/**
 * Format a JS number[] as the pgvector text literal: `[0.1,0.2,0.3]`.
 * pg accepts this when the bound parameter has an explicit `::vector` cast.
 */
export function toPgVectorLiteral(v: number[]): string {
    return '[' + v.map((x) => x.toFixed(6)).join(',') + ']';
}
