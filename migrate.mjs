import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

for (const line of (await readFile('.env', 'utf8')).split(/\r?\n/)) {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z\d_]*)\s*=\s*(.*?)\s*$/);
  if (!match || process.env[match[1]] !== undefined) continue;
  const value = match[2];
  process.env[match[1]] = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
    ? value.slice(1, -1)
    : value;
}

const connectionUrl = new URL(process.env.SUPABASE_DATABASE_CONNECTION_STRING);
if (process.env.SUPABASE_DATABASE_PASSWORD) connectionUrl.password = process.env.SUPABASE_DATABASE_PASSWORD;
if (!connectionUrl.searchParams.has('sslmode')) connectionUrl.searchParams.set('sslmode', 'require');
if (['allow', 'prefer', 'require'].includes(connectionUrl.searchParams.get('sslmode')) && !connectionUrl.searchParams.has('uselibpqcompat')) {
  connectionUrl.searchParams.set('uselibpqcompat', 'true');
}

const pool = new pg.Pool({ connectionString: connectionUrl.toString(), connectionTimeoutMillis: 10000 });
let client;
try {
  const sql = await readFile(resolve('migrations/001_google_user_identity.sql'), 'utf8');
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('Google user identity migration applied.');
} catch (error) {
  if (client) await client.query('ROLLBACK').catch(() => {});
  console.error(`Google user identity migration failed (${error.code || error.name}).`);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
