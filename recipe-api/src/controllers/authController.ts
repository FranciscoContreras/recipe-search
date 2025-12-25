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

function normalizeEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return email.toLowerCase();
    // Remove everything after '+' in the local part
    const cleanLocal = local.split('+')[0];
    return `${cleanLocal}@${domain}`.toLowerCase();
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

    const canonicalEmail = normalizeEmail(email);

    // 2. Rate Limiting (1 request per minute per IP to prevent spamming)
    const lastRequest = requestLog.get(ip);
    if (lastRequest && Date.now() - lastRequest < 60000) {
        return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    }
    requestLog.set(ip, Date.now());

    try {
        // 3. Deactivate any existing active keys for this user (overwrite behavior)
        // We use canonicalEmail to prevent "user+1@..." and "user+2@..." exploits
        await adminSupabase
            .from('api_keys')
            .update({ is_active: false })
            .eq('owner_email', canonicalEmail);

        // 4. Generate New Key
        const { rawKey, hash } = generateApiKey();

        // 5. Store in DB
        // We store the canonicalEmail to enforce the unique constraint and anti-spam
        const { error: dbError } = await adminSupabase
            .from('api_keys')
            .insert([{
                owner_name: email, // Keep original email as name for reference
                owner_email: canonicalEmail, 
                key_hash: hash,
                is_active: true
            }]);

        if (dbError) {
            console.error('DB Insert Error:', dbError);
            return res.status(500).json({ error: 'Failed to generate key.' });
        }

        // 6. Send Email (To the original requested email)
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
