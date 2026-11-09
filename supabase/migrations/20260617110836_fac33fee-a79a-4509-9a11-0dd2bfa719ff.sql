
-- 1. Revoke EXECUTE on internal-only SECURITY DEFINER functions (triggers + helpers)
REVOKE EXECUTE ON FUNCTION public.handle_user_deletion() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_dm_on_friend_accept() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_ntfy() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_super(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, authenticated, PUBLIC;

-- 2. Revoke anon EXECUTE on RPCs that must require an authenticated session
REVOKE EXECUTE ON FUNCTION public.mark_message_read(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_message_delivered(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_conversation_delivered(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_dm_list() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_role_for_admin(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_counts() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_daily_stats(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_top_users(integer) FROM anon, PUBLIC;

-- 3. notification_trigger_events: deny all client access (service_role bypasses RLS)
CREATE POLICY "Deny all client access"
  ON public.notification_trigger_events
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
