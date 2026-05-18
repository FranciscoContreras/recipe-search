import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { findActiveApiKeyByHash, touchApiKeyLastUsed } from '../db/queries';
import { track } from '../utils/background';

// Simple in-memory cache to avoid hitting DB on every request.
// Holds raw API keys → "valid" boolean for CACHE_TTL_MS.
const keyCache = new Map<string, boolean>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
    // Skip auth for health checks or public static files if needed
    if (req.path === '/health' || req.path === '/') {
        return next();
    }

    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
        return res.status(401).json({ error: 'Missing x-api-key header.' });
    }

    // 1. Cache hit — already validated within the TTL
    if (keyCache.has(apiKey)) {
        return next();
    }

    try {
        // 2. Hash and check DB via the shared pool
        const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
        const row  = await findActiveApiKeyByHash(hash);

        if (!row) {
            return res.status(403).json({ error: 'Invalid or inactive API key.' });
        }

        // 3. Update last_used_at in the background — tracked so SIGTERM drains it.
        track(touchApiKeyLastUsed(row.id));

        // 4. Cache the positive result for 60 s
        keyCache.set(apiKey, true);
        setTimeout(() => keyCache.delete(apiKey), CACHE_TTL_MS);

        next();
    } catch (e) {
        console.error('Auth Middleware Error:', e);
        return res.status(500).json({ error: 'Internal authentication error.' });
    }
}
