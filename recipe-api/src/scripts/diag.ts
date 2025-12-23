
import * as dotenv from 'dotenv';
import { resolve } from 'path';

const result = dotenv.config({ path: resolve(__dirname, '../../.env'), debug: true });

if (result.error) {
  console.log('Dotenv error:', result.error);
}

console.log('Parsed:', result.parsed);
console.log('SUPABASE_URL length:', process.env.SUPABASE_URL ? process.env.SUPABASE_URL.length : 'undefined');
console.log('SUPABASE_URL value (first 10):', process.env.SUPABASE_URL ? process.env.SUPABASE_URL.substring(0, 10) : 'undefined');
