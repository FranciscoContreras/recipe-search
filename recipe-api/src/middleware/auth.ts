import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// We MUST use the Service Role Key to query the secure 'api_keys' table
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.warn('⚠️  Auth Warning: SUPABASE_SERVICE_ROLE_KEY missing. API Auth will fail.');
}

const adminSupabase = (SUPABASE_URL && SERVICE_ROLE_KEY) 
    ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    : null;

// Simple in-memory cache to avoid hitting DB on every request (LRU-like)
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

    if (!adminSupabase) {
        return res.status(500).json({ error: 'Server authentication configuration error.' });
    }

    // 1. Check Cache
    if (keyCache.has(apiKey)) {
        return next();
    }

    try {
        // 2. Hash and Check DB
        const hash = crypto.createHash('sha256').update(apiKey).digest('hex');

        const { data, error } = await adminSupabase
            .from('api_keys')
            .select('id, is_active')
            .eq('key_hash', hash)
            .eq('is_active', true)
            .single();

        if (error || !data) {
            return res.status(403).json({ error: 'Invalid or inactive API key.' });
        }

        // 3. Update Last Used (Async, fire-and-forget to not block)
        adminSupabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then();

        // 4. Cache Result
        keyCache.set(apiKey, true);
        setTimeout(() => keyCache.delete(apiKey), CACHE_TTL_MS);

        next();
    } catch (e) {
        console.error('Auth Middleware Error:', e);
        return res.status(500).json({ error: 'Internal authentication error.' });
    }
}
