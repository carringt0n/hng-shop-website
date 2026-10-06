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


export async function getCartRows(userId) {
  const result = await pool.query(
    'SELECT product_id, quantity FROM public.cart_items WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId],
  );
  return result.rows.map(row => ({ productId: Number(row.product_id), quantity: Number(row.quantity) }));
}

export async function setCartItem(userId, productId, quantity) {
  if (quantity === 0) {
    await pool.query('DELETE FROM public.cart_items WHERE user_id = $1 AND product_id = $2', [userId, productId]);
    return;
  }
  await pool.query(
    `INSERT INTO public.cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
    [userId, productId, quantity],
  );
}

export async function clearCart(userId) {
  await pool.query('DELETE FROM public.cart_items WHERE user_id = $1', [userId]);
}

export async function createOrderFromCart(userId, productsById, shipping) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT product_id, quantity FROM public.cart_items WHERE user_id = $1 ORDER BY product_id FOR UPDATE',
      [userId],
    );
    if (!result.rows.length) throw new Error('CART_EMPTY');
    const items = result.rows.map(row => {
      const product = productsById.get(Number(row.product_id));
      if (!product) throw new Error('PRODUCT_UNAVAILABLE');
      return { product, quantity: Number(row.quantity) };
    });
    const total = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    const created = await client.query(
      `INSERT INTO public.orders (user_id, total_ngn, shipping_name, shipping_email, shipping_address, shipping_city, shipping_postal_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, status, currency, total_ngn, created_at`,
      [userId, total, shipping.name, shipping.email, shipping.address, shipping.city, shipping.postalCode],
    );
    for (const { product, quantity } of items) {
      await client.query(
        'INSERT INTO public.order_items (order_id, product_id, product_name, unit_price_ngn, quantity) VALUES ($1, $2, $3, $4, $5)',
        [created.rows[0].id, product.id, product.name, product.price, quantity],
      );
    }
    await client.query('DELETE FROM public.cart_items WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
    const row = created.rows[0];
    return { id: String(row.id), status: row.status, currency: row.currency.trim(), total: Number(row.total_ngn), createdAt: row.created_at };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listOrders(userId) {
  const result = await pool.query(
    'SELECT id, status, currency, total_ngn, created_at FROM public.orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    [userId],
  );
  return result.rows.map(row => ({ id: String(row.id), status: row.status, currency: row.currency.trim(), total: Number(row.total_ngn), createdAt: row.created_at }));
}
