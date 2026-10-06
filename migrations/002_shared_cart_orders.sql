CREATE TABLE IF NOT EXISTS public.cart_items (
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  product_id integer NOT NULL CHECK (product_id > 0),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'placed',
  currency char(3) NOT NULL DEFAULT 'NGN',
  total_ngn bigint NOT NULL CHECK (total_ngn >= 0),
  shipping_name text NOT NULL,
  shipping_email text NOT NULL,
  shipping_address text NOT NULL,
  shipping_city text NOT NULL,
  shipping_postal_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_items (
  order_id bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id integer NOT NULL CHECK (product_id > 0),
  product_name text NOT NULL,
  unit_price_ngn bigint NOT NULL CHECK (unit_price_ngn >= 0),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  PRIMARY KEY (order_id, product_id)
);

CREATE INDEX IF NOT EXISTS orders_user_created_idx ON public.orders(user_id, created_at DESC);
