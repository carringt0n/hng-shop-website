# hng-shopwebsite
# FORMA shop

Responsive storefront UI with mock product and order data, plus Google sign-in through Google Identity Services OAuth credentials.

## Run locally

1. Copy `.env.example` to `.env` and add the Web application OAuth client ID and client secret from Google Cloud Console. Keep `.env` private; it is ignored by Git.
2. In the Google Cloud Console OAuth client, add `http://localhost:3000` under **Authorized JavaScript origins** and `http://localhost:3000/auth/google/callback` under **Authorized redirect URIs**.
3. Apply the additive Google identity column/index to the existing `public.users` table:

   ```sh
   npm run db:migrate
   ```

4. Start the app with Node.js 20 or newer:

   ```sh
   npm start
   ```

5. Open `http://localhost:3000/login.html`.

For a deployed site, set `APP_BASE_URL` to its HTTPS origin and register `${APP_BASE_URL}/auth/google/callback` as an authorized redirect URI. Register the exact origin under Authorized JavaScript origins as well.

Google sign-in exchanges the authorization code on the server, verifies the Google ID token signature, issuer, audience, expiry, and nonce, then upserts the user's Google ID, email, and name into `public.users` before issuing an HttpOnly session cookie. Email/password sign-in, checkout, and orders remain mock UI. Sessions are held in memory and are cleared when the server restarts, so use a persistent session store before running multiple server instances or relying on production sessions.

The database connection uses TLS. To verify the Supabase server certificate as well as encrypting traffic, download the project CA certificate from Supabase **Database Settings → SSL Configuration** and configure the connection string with `sslmode=verify-full` and `sslrootcert` pointing to that certificate.
