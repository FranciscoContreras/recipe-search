import { Request, Response } from 'express';
import crypto from 'crypto';
import { sendApiKeyEmail } from '../services/email';
import { pool } from '../db/queries';

function generateApiKey() {
    const rawKey = 'sk_' + crypto.randomBytes(32).toString('hex');
    const hash   = crypto.createHash('sha256').update(rawKey).digest('hex');
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
        // 3. Deactivate any existing active keys for this user (overwrite behavior).
        // We use canonicalEmail to prevent "user+1@..." and "user+2@..." exploits.
        await pool.query(
            `UPDATE api_keys SET is_active = false WHERE owner_email = $1`,
            [canonicalEmail],
        );

        // 4. Generate New Key
        const { rawKey, hash } = generateApiKey();

        // 5. Store in DB. Store canonicalEmail to enforce the unique constraint and anti-spam.
        try {
            await pool.query(
                `INSERT INTO api_keys (owner_name, owner_email, key_hash, is_active)
                 VALUES ($1, $2, $3, true)`,
                [email, canonicalEmail, hash],
            );
        } catch (dbError) {
            console.error('DB Insert Error:', dbError);
            return res.status(500).json({ error: 'Failed to generate key.' });
        }

        // 6. Send Email (to the original requested email)
        const sent = await sendApiKeyEmail(email, rawKey);

        if (!sent) {
            // Rollback (delete key) if email fails
            await pool.query(`DELETE FROM api_keys WHERE key_hash = $1`, [hash]);
            return res.status(500).json({ error: 'Failed to send email. Please try again.' });
        }

        return res.status(200).json({ message: 'API Key sent to your email!' });

    } catch (e) {
        console.error('Request Key Error:', e);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
