import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { Database } from './database.types';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase URL or Key is missing. Please check your .env file.');
  process.exit(1);
}

export const supabase: SupabaseClient<Database> = createClient<Database>(supabaseUrl, supabaseKey);
