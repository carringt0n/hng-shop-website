import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.SUPABASE_DATABASE_CONNECTION_STRING;
if (!connectionString) {
  throw new Error('Set SUPABASE_DATABASE_CONNECTION_STRING in .env.');
}
const connectionUrl = new URL(connectionString);
if (process.env.SUPABASE_DATABASE_PASSWORD) connectionUrl.password = process.env.SUPABASE_DATABASE_PASSWORD;
if (!connectionUrl.searchParams.has('sslmode')) connectionUrl.searchParams.set('sslmode', 'require');
if (['allow', 'prefer', 'require'].includes(connectionUrl.searchParams.get('sslmode')) && !connectionUrl.searchParams.has('uselibpqcompat')) {
  connectionUrl.searchParams.set('uselibpqcompat', 'true');
}

const pool = new Pool({
  connectionString: connectionUrl.toString(),
  max: 5,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

pool.on('error', () => {
  console.error('An idle Supabase database connection failed.');
});

export async function saveGoogleUser(user) {
  const result = await pool.query(
    `INSERT INTO public.users (google_sub, email, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (google_sub) DO UPDATE SET
       email = EXCLUDED.email,
       name = EXCLUDED.name
     RETURNING id, google_sub, email, name, created_at`,
    [user.id, user.email, user.name],
  );
  return result.rows[0];
}
