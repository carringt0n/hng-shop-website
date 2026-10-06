import { readFile } from 'node:fs/promises';
import { getCartRows, setCartItem, clearCart, createOrderFromCart, listOrders } from './database.mjs';

const catalog = JSON.parse(await readFile(new URL('./catalog.json', import.meta.url), 'utf8'));
const productsById = new Map(catalog.products.map(product => [product.id, product]));
const sendJson = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
};
async function bodyJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 16000) throw new Error('BODY_TOO_LARGE');
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('INVALID_JSON'); }
}

export async function handleApi(request, response, session) {
  const url = new URL(request.url, 'http://localhost');
  if (request.method === 'GET' && url.pathname === '/api/products') {
    sendJson(response, 200, catalog);
    return true;
  }
  if (!url.pathname.startsWith('/api/')) return false;
  if (!session?.userId) {
    sendJson(response, 401, { error: 'Sign in to use your account cart and orders.' });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/cart') {
    const rows = await getCartRows(session.userId);
    sendJson(response, 200, { items: rows.map(row => ({ ...row, product: productsById.get(row.productId) })).filter(row => row.product) });
    return true;
  }
  if (request.method === 'PUT' && /^\/api\/cart\/items\/\d+$/.test(url.pathname)) {
    const productId = Number(url.pathname.split('/').at(-1));
    const input = await bodyJson(request);
    const quantity = Number(input.quantity);
    if (!productsById.has(productId) || !Number.isInteger(quantity) || quantity < 0 || quantity > 99) {
      sendJson(response, 400, { error: 'Invalid product or quantity.' });
      return true;
    }
    await setCartItem(session.userId, productId, quantity);
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (request.method === 'DELETE' && url.pathname === '/api/cart') {
    await clearCart(session.userId);
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/orders') {
    sendJson(response, 200, { orders: await listOrders(session.userId) });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/checkout') {
    const input = await bodyJson(request);
    if (!input.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email || '') || !input.address?.trim() || !input.city?.trim() || !input.postal?.trim()) {
      sendJson(response, 400, { error: 'Complete your contact and delivery details.' });
      return true;
    }
    try {
      const order = await createOrderFromCart(session.userId, productsById, { name: input.name.trim(), email: input.email.trim(), address: input.address.trim(), city: input.city.trim(), postalCode: input.postal.trim() });
      sendJson(response, 201, { order, note: 'Order recorded; no payment was collected.' });
    } catch (error) {
      if (error.message === 'CART_EMPTY') sendJson(response, 409, { error: 'Your cart is empty.' });
      else if (error.message === 'PRODUCT_UNAVAILABLE') sendJson(response, 409, { error: 'A cart item is no longer available.' });
      else throw error;
    }
    return true;
  }
  sendJson(response, 404, { error: 'API route not found.' });
  return true;
}
