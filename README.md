# FORMA shop

Responsive furniture and home-object storefront with a Google sign-in server, Supabase Postgres persistence, and a separate Expo mobile app in `mobile/`.

## Existing web app

The website is plain HTML, CSS, and JavaScript served by `server.mjs` (Node.js 20 or newer). It keeps the existing catalogue and uses a browser-local cart for guests. Signed-in users share their cart and order history with mobile through the server API. Google OAuth credentials and the Supabase database connection are read from the root `.env`; keep that file private.

To apply the idempotent user/cart/order migrations and start the website:

```sh
npm run db:migrate
npm start
```

Open `http://localhost:3000`. The root `.env.example` lists the required Google and Supabase settings. For production, set `APP_BASE_URL` to the HTTPS origin and register its `/auth/google/callback` URI in the Google Web OAuth client.

## Mobile app

See [mobile/README.md](mobile/README.md) for Expo setup, physical-phone networking, Google OAuth handoff, and shared-cart checks. The app calls the same backend; it does not contain server credentials. Checkout records a mock order with no payment collection.

## API endpoints

- `GET /api/products` ? shared NGN catalogue.
- `GET /api/cart` ? authenticated server-side cart.
- `PUT /api/cart/items/:productId` ? set a cart quantity (zero removes).
- `DELETE /api/cart` ? clear the cart.
- `GET /api/orders` ? authenticated order history.
- `POST /api/checkout` ? record a mock order from the cart; no payment is collected.
- `GET /auth/google`, `GET /auth/google/callback`, `GET /auth/me`, `POST /auth/logout` ? existing web Google login and session endpoints.

Web sessions and native bearer sessions are currently held in server memory and expire after 24 hours; a server restart invalidates them. Cart and order records persist in Supabase.
