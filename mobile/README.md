# Forma Living mobile app

This is a separate Expo React Native app. The website remains at the repository root. Both clients use the same Node API and Supabase database for Google identities, signed-in carts, and mock orders. The current catalogue is the same NGN-priced presentation data used by the website because the inspected project has no product table or product API.

## One-time setup

1. From the repository root, install the mobile packages if they are not already installed:

   ```sh
   cd mobile
   npm install
   npx expo install expo-auth-session expo-web-browser expo-secure-store expo-crypto
   ```

2. Apply the additive database migration from the repository root. It adds cart/order tables referencing the existing `public.users.id` bigint and keeps the Google-user migration idempotent:

   ```sh
   cd ..
   npm run db:migrate
   ```

3. Start the existing server once, then in a second root terminal create an HTTPS tunnel for the phone:

   ```sh
   npx localtunnel --port 3000
   ```

   Copy the HTTPS URL it prints. Keep that tunnel running. Set `APP_BASE_URL` in the root `.env` to that exact origin, then add `APP_BASE_URL/auth/google/callback` as an Authorized redirect URI and the origin itself as an Authorized JavaScript origin in the existing Google Web OAuth client. Restart the root server after editing `.env`.

4. Create `mobile/.env` from `mobile/.env.example` and set `EXPO_PUBLIC_API_URL` to the same HTTPS tunnel origin. This is a public API address, not a secret. Never copy database credentials or the Google client secret into the mobile app.

5. In another terminal, start Expo on the same Wi-Fi network as the phone:

   ```sh
   cd mobile
   npx expo start --lan --port 8081
   ```

   Open the QR code in Expo Go. On iOS, Expo Go and the CLI must be signed into the same Expo account. Expo's AuthSession uses a development deep link in Expo Go and the configured `forma://auth/callback` scheme in a native development build.

The server requires HTTPS for non-localhost `APP_BASE_URL`; the HTTPS tunnel lets the physical phone use Google OAuth without sending session cookies over local Wi-Fi. If the tunnel URL changes, update both environment files and the Google OAuth redirect URI, then restart the server and Expo CLI.

## Shared API behavior

- `GET /api/products`: the shared catalogue.
- `GET /api/cart`: current signed-in user's cart.
- `PUT /api/cart/items/:productId` with `{ "quantity": n }`: set quantity; zero removes the item.
- `DELETE /api/cart`: clear the signed-in cart.
- `GET /api/orders`: latest account orders.
- `POST /api/checkout`: validates delivery details, records a mock order and item-price snapshots, and clears the account cart. It does not take payment.

The website keeps its existing browser-local guest cart; after Google sign-in, it merges that guest cart into the account cart and thereafter reads and writes the server cart. The mobile app requires Google sign-in before cart mutations. It refreshes the server cart when the Cart screen opens and when the app returns to the foreground. These are refresh points, not realtime push synchronization.

Mobile Google sign-in reuses the existing server-side OAuth client secret and ID-token verification. A short-lived, single-use handoff code returns from the server to the app; the app exchanges it for a 24-hour opaque bearer token stored in Expo SecureStore. The existing web login continues to use its HttpOnly cookie. Both sessions resolve to the same database user. Sessions are currently held in memory, so restarting the Node server signs both clients out.

## Manual shared-cart checks on a phone

After the database migration has run and the website and Expo app are available on the same network/tunnel:

1. Sign into the website with Google, add a product, open the Expo app, sign into the same Google account, and open Bag. The product and quantity should match.
2. Add a different product on mobile. Return to the website; the server cart refreshes when the page regains focus. Confirm the new item appears.
3. Change a quantity on mobile, return to the website, and confirm the server quantity refreshed.
4. Remove an item on mobile, return to the website, and confirm it is gone.

Checkout records an order in Supabase but deliberately has no payment integration. The website Order History and mobile account screen both read the same account orders.
