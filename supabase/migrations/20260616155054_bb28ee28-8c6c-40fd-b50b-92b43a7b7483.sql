
-- 1) Restrict storage listing to authenticated users (public CDN URLs still serve files)
DROP POLICY IF EXISTS "Avatars are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Chat images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view chat videos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can listen to voice messages" ON storage.objects;

CREATE POLICY "Authenticated can list avatars"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'avatars');

CREATE POLICY "Authenticated can list chat images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-images');

CREATE POLICY "Authenticated can list chat videos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-videos');

CREATE POLICY "Authenticated can list voice messages"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-voice');

-- 2) Lock down SECURITY DEFINER functions to only roles that need EXECUTE.

-- Trigger-only functions: not callable via API by anyone
REVOKE ALL ON FUNCTION public.notify_ntfy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_user_deletion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_dm_on_friend_accept() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- Admin RPCs: only signed-in users (function still self-checks for admin role)
REVOKE ALL ON FUNCTION public.get_admin_analytics_counts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_admin_daily_stats(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_admin_top_users(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_role_for_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_daily_stats(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_top_users(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role_for_admin(uuid) TO authenticated;

-- Role/membership helpers: needed by RLS for authenticated, never by anon
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin_or_super(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_conversation_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_or_super(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO authenticated;
