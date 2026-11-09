-- Create a function to get user role for admins
CREATE OR REPLACE FUNCTION public.get_user_role_for_admin(_target_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role::text FROM public.user_roles WHERE user_id = _target_user_id LIMIT 1),
    'user'
  )
  WHERE is_admin_or_super(auth.uid())
$$;