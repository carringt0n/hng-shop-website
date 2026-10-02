ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS google_sub text;

CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_uidx
  ON public.users (google_sub);
