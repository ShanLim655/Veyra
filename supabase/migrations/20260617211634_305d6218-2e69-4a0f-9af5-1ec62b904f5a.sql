
-- 1. Fix privilege escalation on conversation_members
DROP POLICY IF EXISTS "Users can insert themselves into conversations" ON public.conversation_members;
DROP POLICY IF EXISTS "Users can join conversations" ON public.conversation_members;
DROP POLICY IF EXISTS "Members can insert into conversations" ON public.conversation_members;

-- Recreate strict INSERT policy: only existing members of the conversation can add rows.
-- New DM creation happens via the SECURITY DEFINER function below.
CREATE POLICY "Existing members can add members"
  ON public.conversation_members
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_conversation_member(conversation_id, auth.uid()));

-- 2. Secure RPC to create or fetch a DM with an accepted friend
CREATE OR REPLACE FUNCTION public.get_or_create_dm(_other_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _conv uuid;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _other_user_id IS NULL OR _other_user_id = _me THEN
    RAISE EXCEPTION 'Invalid target user';
  END IF;

  -- Require an accepted friendship between the two users
  IF NOT EXISTS (
    SELECT 1 FROM public.friend_requests
    WHERE status = 'accepted'
      AND ((sender_id = _me AND receiver_id = _other_user_id)
        OR (sender_id = _other_user_id AND receiver_id = _me))
  ) THEN
    RAISE EXCEPTION 'You can only message accepted friends';
  END IF;

  -- Look for an existing 1:1 conversation containing both users
  SELECT c.id INTO _conv
  FROM public.conversations c
  JOIN public.conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = _me
  JOIN public.conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = _other_user_id
  WHERE c.is_group = false
  LIMIT 1;

  IF _conv IS NOT NULL THEN
    RETURN _conv;
  END IF;

  INSERT INTO public.conversations (is_group, created_by)
  VALUES (false, _me)
  RETURNING id INTO _conv;

  INSERT INTO public.conversation_members (conversation_id, user_id)
  VALUES (_conv, _me), (_conv, _other_user_id);

  RETURN _conv;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_dm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm(uuid) TO authenticated;

-- 3. Lock down SECURITY DEFINER functions from anonymous callers.
-- Trigger and internal helper functions: revoke from anon AND authenticated.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_user_deletion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_dm_on_friend_accept() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_ntfy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- RPC functions exposed to signed-in users: revoke from anon only.
REVOKE ALL ON FUNCTION public.mark_global_mentions_read() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_message_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_message_delivered(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_conversation_delivered(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_dm_list() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_admin_analytics_counts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_admin_daily_stats(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_admin_top_users(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_role_for_admin(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.mark_global_mentions_read() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_message_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_message_delivered(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_delivered(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_dm_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_daily_stats(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_top_users(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role_for_admin(uuid) TO authenticated;

-- Helper functions used in RLS policies: revoke from anon (they still work inside policies).
REVOKE ALL ON FUNCTION public.is_conversation_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin_or_super(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_or_super(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;

-- 4. Public bucket listing: drop broad SELECT policies. Files in public buckets
-- remain accessible via their direct public URL; only enumeration is removed.
DROP POLICY IF EXISTS "Authenticated can list avatars" ON storage.objects;
DROP POLICY IF EXISTS "Banners are publicly accessible" ON storage.objects;
