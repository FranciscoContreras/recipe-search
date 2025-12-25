import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { sendApiKeyEmail } from '../services/email';

// Must use Service Role to write to api_keys table
const adminSupabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function generateApiKey() {
    const rawKey = 'sk_' + crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    return { rawKey, hash };
}

function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// In-memory rate limiting (simple)
// Map<IP, timestamp>
const requestLog = new Map<string, number>();

export async function requestApiKey(req: Request, res: Response) {
    const { email } = req.body;
    const ip = req.ip || 'unknown';

    // 1. Basic Validation
    if (!email || !isValidEmail(email)) {
        return res.status(400).json({ error: 'Valid email is required.' });
    }

    // 2. Rate Limiting (1 request per minute per IP to prevent spamming)
    const lastRequest = requestLog.get(ip);
    if (lastRequest && Date.now() - lastRequest < 60000) {
        return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    }
    requestLog.set(ip, Date.now());

    try {
        // 3. Check for existing active key
        const { data: existing } = await adminSupabase
            .from('api_keys')
            .select('id')
            .eq('owner_email', email)
            .eq('is_active', true)
            .single();

        if (existing) {
            // Option: Resend existing key? No, we don't have the raw key.
            // Option: Tell them they already have one.
            return res.status(409).json({ error: 'An active API Key already exists for this email.' });
        }

        // 4. Generate New Key
        const { rawKey, hash } = generateApiKey();

        // 5. Store in DB
        const { error: dbError } = await adminSupabase
            .from('api_keys')
            .insert([{
                owner_name: email, // Use email as name for now
                owner_email: email,
                key_hash: hash,
                is_active: true
            }]);

        if (dbError) {
            console.error('DB Insert Error:', dbError);
            return res.status(500).json({ error: 'Failed to generate key.' });
        }

        // 6. Send Email
        const sent = await sendApiKeyEmail(email, rawKey);

        if (!sent) {
            // Rollback (delete key) if email fails
            await adminSupabase.from('api_keys').delete().eq('key_hash', hash);
            return res.status(500).json({ error: 'Failed to send email. Please try again.' });
        }

        return res.status(200).json({ message: 'API Key sent to your email!' });

    } catch (e) {
        console.error('Request Key Error:', e);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
