
CREATE OR REPLACE FUNCTION public.get_user_sessions()
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  user_agent text,
  ip text,
  aal text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT s.id, s.created_at, s.updated_at, s.user_agent, host(s.ip)::text, s.aal::text
  FROM auth.sessions s
  WHERE s.user_id = auth.uid()
  ORDER BY s.updated_at DESC NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION public.revoke_user_session(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  DELETE FROM auth.sessions
  WHERE id = _session_id AND user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_sessions() FROM public, anon;
REVOKE ALL ON FUNCTION public.revoke_user_session(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_user_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_session(uuid) TO authenticated;
