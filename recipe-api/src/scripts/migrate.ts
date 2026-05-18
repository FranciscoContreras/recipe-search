#!/usr/bin/env ts-node
/**
 * Minimal in-house migrator for the self-hosted Postgres.
 *
 * Tracks applied filenames in a `schema_migrations` table; reads
 * `supabase/migrations/*.sql` in lexical order; applies anything not yet
 * recorded. One transaction per file.
 *
 * Usage:
 *   DATABASE_URL=postgresql://recipe_owner:pw@localhost:5432/recipe_base \
 *     npx ts-node src/scripts/migrate.ts [--dry-run]
 *
 * Notes:
 *  - DATABASE_URL MUST point at a role with CREATE rights on `public` —
 *    typically `recipe_owner`, not the app role.
 *  - We never modify or re-apply migrations. If you need to fix a bad
 *    migration, ship a forward-only patch.
 */

import dotenv from 'dotenv';
import path from 'path';
import { promises as fs } from 'fs';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface CliArgs {
    dryRun:        boolean;
    migrationsDir: string;
}

function parseArgs(argv: string[]): CliArgs {
    let dryRun = false;
    let dir    = path.resolve(__dirname, '../../../supabase/migrations');
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry-run')                dryRun = true;
        else if (a === '--dir' || a === '-d') dir = path.resolve(argv[++i]);
        else if (a === '--help' || a === '-h') {
            console.log('Usage: migrate [--dry-run] [--dir <migrations-dir>]');
            process.exit(0);
        }
    }
    return { dryRun, migrationsDir: dir };
}

async function ensureMigrationTable(client: Client): Promise<void> {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
}

async function listApplied(client: Client): Promise<Set<string>> {
    const { rows } = await client.query<{ version: string }>(`SELECT version FROM schema_migrations`);
    return new Set(rows.map((r) => r.version));
}

async function listMigrationFiles(dir: string): Promise<string[]> {
    let entries: string[];
    try {
        entries = await fs.readdir(dir);
    } catch (err: any) {
        throw new Error(`Cannot read migrations dir ${dir}: ${err.message}`);
    }
    return entries.filter((f) => f.endsWith('.sql')).sort();
}

async function applyMigration(client: Client, dir: string, file: string, dryRun: boolean): Promise<void> {
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    if (dryRun) {
        console.log(`  [dry-run] would apply ${file} (${sql.length} bytes)`);
        return;
    }
    await client.query('BEGIN');
    try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [file]);
        await client.query('COMMIT');
        console.log(`  applied  ${file}`);
    } catch (err: any) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${file} failed: ${err.message}`);
    }
}

async function main(): Promise<void> {
    const args         = parseArgs(process.argv);
    const DATABASE_URL = process.env.DATABASE_URL;
    if (!DATABASE_URL) {
        console.error('DATABASE_URL is required.');
        process.exit(1);
    }

    console.log(`[migrate] dir=${args.migrationsDir}`);
    if (args.dryRun) console.log('[migrate] DRY RUN — no changes will be written.');

    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
        if (!args.dryRun) await ensureMigrationTable(client);
        const applied = args.dryRun ? new Set<string>() : await listApplied(client);
        const files   = await listMigrationFiles(args.migrationsDir);

        const pending = files.filter((f) => !applied.has(f));
        console.log(`[migrate] ${files.length} on disk, ${applied.size} already applied, ${pending.length} pending.`);

        for (const f of pending) {
            await applyMigration(client, args.migrationsDir, f, args.dryRun);
        }

        if (pending.length === 0) console.log('[migrate] nothing to do.');
        else                       console.log('[migrate] done.');
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    console.error('[migrate] fatal:', err);
    process.exit(1);
});
