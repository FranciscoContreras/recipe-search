import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';

// Load env from correct path
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function generateApiKey() {
    // Generate a random 32-byte hex string (64 chars)
    const rawKey = 'sk_' + crypto.randomBytes(32).toString('hex');
    // Hash it for storage
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    return { rawKey, hash };
}

async function createKey(ownerName: string) {
    const { rawKey, hash } = generateApiKey();

    console.log(`Generating key for: ${ownerName}...`);

    const { data, error } = await supabase
        .from('api_keys')
        .insert([
            {
                owner_name: ownerName,
                key_hash: hash,
                is_active: true
            }
        ])
        .select()
        .single();

    if (error) {
        console.error('Failed to insert key:', error.message);
        return;
    }

    console.log('\n✅ API Key Created Successfully!');
    console.log('--------------------------------------------------');
    console.log(`Owner:   ${ownerName}`);
    console.log(`Key ID:  ${data.id}`);
    console.log(`API Key: ${rawKey}`);
    console.log('--------------------------------------------------');
    console.log('⚠️  SAVE THIS KEY NOW. It is not stored in the database and cannot be recovered.');
}

const owner = process.argv[2];
if (!owner) {
    console.log('Usage: npx ts-node src/scripts/generate_key.ts "Owner Name"');
} else {
    createKey(owner);
}
