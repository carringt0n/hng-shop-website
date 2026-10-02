import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

async function loadEnv() {
  try {
    const contents = await readFile(resolve(root, '.env'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z\d_]*)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, '');
      }
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

await loadEnv();
const { saveGoogleUser } = await import('./database.mjs');

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env before starting the server.');
}

const port = Number(process.env.PORT || 3000);
const appBase = new URL(process.env.APP_BASE_URL || `http://localhost:${port}`);
if (appBase.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(appBase.hostname)) {
  throw new Error('APP_BASE_URL must use HTTPS outside localhost.');
}
const baseUrl = appBase.origin;
const redirectUri = `${baseUrl}/auth/google/callback`;
const secureCookies = appBase.protocol === 'https:';
const states = new Map();
const sessions = new Map();
let signingKeys;
let signingKeysExpireAt = 0;

const cookie = (name, value, maxAge, httpOnly = true) =>
  `${name}=${value}; Path=/; SameSite=Lax; Max-Age=${maxAge}${httpOnly ? '; HttpOnly' : ''}${secureCookies ? '; Secure' : ''}`;

function parseCookies(request) {
  const parsed = {};
  for (const part of (request.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    try { parsed[key] = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* Ignore malformed cookies. */ }
  }
  return parsed;
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function getGoogleSigningKeys(forceRefresh = false) {
  if (!forceRefresh && signingKeys && Date.now() < signingKeysExpireAt) return signingKeys;
  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Could not load Google signing keys.');
  const data = await response.json();
  signingKeys = Object.fromEntries((data.keys || []).map((key) => [key.kid, key]));
  const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] || 3600);
  signingKeysExpireAt = Date.now() + maxAge * 1000;
  return signingKeys;
}

async function verifyGoogleIdToken(idToken, expectedNonce) {
  if (typeof idToken !== 'string' || idToken.length > 12000) throw new Error('Invalid Google ID token.');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid Google ID token.');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Unsupported Google ID token.');

  let keys = await getGoogleSigningKeys();
  if (!keys[header.kid]) keys = await getGoogleSigningKeys(true);
  const certificate = keys[header.kid];
  if (!certificate) throw new Error('Unknown Google signing key.');
  const publicKey = createPublicKey({ key: certificate, format: 'jwk' });
  const signedData = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], 'base64url');
  if (!verify('RSA-SHA256', signedData, publicKey, signature)) throw new Error('Google ID token signature is invalid.');

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('Invalid Google ID token issuer.');
  if (!audiences.includes(clientId) || (claims.azp && claims.azp !== clientId)) throw new Error('Google ID token is for a different client.');
  if (!Number.isFinite(claims.exp) || claims.exp <= now || (claims.iat && claims.iat > now + 300)) throw new Error('Google ID token has expired or is not yet valid.');
  if (claims.nonce !== expectedNonce) throw new Error('Google ID token nonce did not match.');
  if (!claims.sub || !claims.email || !(claims.email_verified === true || claims.email_verified === 'true')) throw new Error('Google did not return a verified email address.');
  return { id: claims.sub, email: claims.email, name: claims.name || '', picture: claims.picture || '' };
}

function redirect(response, location, headers = {}) {
  response.writeHead(303, { Location: location, 'Cache-Control': 'no-store', ...headers });
  response.end();
}

async function handleCallback(request, response, url) {
  const params = url.searchParams;
  const state = params.get('state');
  const cookies = parseCookies(request);
  const pending = state && states.get(state);
  if (!pending || cookies.forma_oauth_state !== state || Date.now() - pending.createdAt > 10 * 60 * 1000) {
    states.delete(state);
    return redirect(response, '/login.html?auth_error=state', { 'Set-Cookie': cookie('forma_oauth_state', '', 0) });
  }
  states.delete(state);
  const clearState = cookie('forma_oauth_state', '', 0);
  if (params.has('error')) return redirect(response, '/login.html?auth_error=cancelled', { 'Set-Cookie': clearState });

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: params.get('code') || '',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: pending.codeVerifier,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.id_token) throw new Error('Google authorization code exchange failed.');
    const user = await verifyGoogleIdToken(tokens.id_token, pending.nonce);
    await saveGoogleUser(user);
    const sessionId = randomBytes(32).toString('base64url');
    sessions.set(sessionId, { user, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
    redirect(response, '/login.html?login=success', {
      'Set-Cookie': [clearState, cookie('forma_session', sessionId, 24 * 60 * 60)],
    });
  } catch (error) {
    console.error('Google sign-in failed:', error.message);
    redirect(response, '/login.html?auth_error=google', { 'Set-Cookie': clearState });
  }
}

const staticFiles = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/login.html': 'login.html',
  '/styles.css': 'styles.css',
  '/script.js': 'script.js',
  '/auth.js': 'auth.js',
};
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, baseUrl);
    if (request.method === 'GET' && url.pathname === '/auth/google') {
      const state = randomBytes(32).toString('base64url');
      const nonce = randomBytes(32).toString('base64url');
      const codeVerifier = randomBytes(32).toString('base64url');
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
      states.set(state, { nonce, codeVerifier, createdAt: Date.now() });
      const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorizationUrl.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).toString();
      return redirect(response, authorizationUrl.toString(), { 'Set-Cookie': cookie('forma_oauth_state', state, 600) });
    }
    if (request.method === 'GET' && url.pathname === '/auth/google/callback') return await handleCallback(request, response, url);
    if (request.method === 'GET' && url.pathname === '/auth/me') {
      const session = sessions.get(parseCookies(request).forma_session);
      if (!session || session.expiresAt <= Date.now()) return sendJson(response, 200, { authenticated: false });
      return sendJson(response, 200, { authenticated: true, user: session.user });
    }
    if (request.method === 'POST' && url.pathname === '/auth/logout') {
      sessions.delete(parseCookies(request).forma_session);
      return sendJson(response, 200, { ok: true }, { 'Set-Cookie': cookie('forma_session', '', 0) });
    }
    if (request.method !== 'GET' || !staticFiles[url.pathname]) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
      return response.end('Not found');
    }
    const filename = staticFiles[url.pathname];
    const contents = await readFile(resolve(root, filename));
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(filename)],
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': filename.endsWith('.html') ? 'no-cache' : 'public, max-age=300',
    });
    response.end(contents);
  } catch (error) {
    console.error('Request failed:', error.message);
    if (!response.headersSent) sendJson(response, 500, { error: 'The request could not be completed.' });
    else response.end();
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [state, pending] of states) if (now - pending.createdAt > 10 * 60 * 1000) states.delete(state);
  for (const [sessionId, session] of sessions) if (session.expiresAt <= now) sessions.delete(sessionId);
}, 60 * 60 * 1000).unref();

server.listen(port, () => console.log(`FORMA shop running at ${baseUrl}`));
