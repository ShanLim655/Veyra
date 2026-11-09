
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS global_mentions_last_read_at timestamptz;

CREATE OR REPLACE FUNCTION public.mark_global_mentions_read()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.profiles SET global_mentions_last_read_at = now() WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.mark_global_mentions_read() TO authenticated;
