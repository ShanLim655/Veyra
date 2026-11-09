-- Restore EXECUTE on helper functions used inside RLS policies.
-- RLS policy expressions run as the querying role, so authenticated must be able
-- to execute these helpers or every policy that calls them returns false.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_admin_or_super(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO authenticated, anon;