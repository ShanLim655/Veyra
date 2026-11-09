
-- 1. Role column on conversation_members
ALTER TABLE public.conversation_members
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner','admin','member'));

-- Backfill: existing creators of group conversations become owner
UPDATE public.conversation_members cm
SET role = 'owner'
FROM public.conversations c
WHERE c.id = cm.conversation_id
  AND c.is_group = true
  AND c.created_by = cm.user_id
  AND cm.role = 'member';

-- 2. Helper: is the user an owner/admin of this conversation?
CREATE OR REPLACE FUNCTION public.is_group_admin(_conversation_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = _conversation_id
      AND user_id = _user_id
      AND role IN ('owner','admin')
  )
$$;

CREATE OR REPLACE FUNCTION public.is_group_owner(_conversation_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = _conversation_id
      AND user_id = _user_id
      AND role = 'owner'
  )
$$;

-- 3. Tighten policies
DROP POLICY IF EXISTS "Existing members can add members" ON public.conversation_members;
CREATE POLICY "Owners and admins can add members"
ON public.conversation_members
FOR INSERT
WITH CHECK (
  -- Self-insert is allowed only as part of creating a fresh conversation
  -- (creator inserts themselves). For groups, owners/admins add others.
  public.is_group_admin(conversation_id, auth.uid())
  OR NOT EXISTS (SELECT 1 FROM public.conversation_members WHERE conversation_id = conversation_members.conversation_id)
  OR (
    -- Allow self-insert during 1:1 DM creation via existing flow (creator only)
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_members.conversation_id
        AND c.is_group = false
        AND c.created_by = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "Users can update their group conversations" ON public.conversations;
CREATE POLICY "Owners and admins can update group conversations"
ON public.conversations
FOR UPDATE
USING (
  (is_group = true AND public.is_group_admin(id, auth.uid()))
  OR (is_group = false AND public.is_conversation_member(id, auth.uid()))
);

-- 4. RPC: create group
CREATE OR REPLACE FUNCTION public.create_group_chat(_name text, _member_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
  _conv uuid;
  _id uuid;
  _friend_count int;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _name IS NULL OR length(trim(_name)) = 0 THEN
    RAISE EXCEPTION 'Group name required';
  END IF;
  IF _member_ids IS NULL OR array_length(_member_ids, 1) IS NULL OR array_length(_member_ids, 1) < 1 THEN
    RAISE EXCEPTION 'At least one other member required';
  END IF;
  IF _me = ANY(_member_ids) THEN
    RAISE EXCEPTION 'Do not include yourself in member list';
  END IF;

  -- All ids must be accepted friends of caller
  SELECT count(DISTINCT other) INTO _friend_count
  FROM (
    SELECT CASE WHEN sender_id = _me THEN receiver_id ELSE sender_id END AS other
    FROM public.friend_requests
    WHERE status = 'accepted'
      AND (sender_id = _me OR receiver_id = _me)
  ) f
  WHERE f.other = ANY(_member_ids);

  IF _friend_count <> (SELECT count(DISTINCT x) FROM unnest(_member_ids) x) THEN
    RAISE EXCEPTION 'All members must be your friends';
  END IF;

  INSERT INTO public.conversations (is_group, created_by, name)
  VALUES (true, _me, trim(_name))
  RETURNING id INTO _conv;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (_conv, _me, 'owner');

  FOREACH _id IN ARRAY (SELECT array_agg(DISTINCT x) FROM unnest(_member_ids) x) LOOP
    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (_conv, _id, 'member');
  END LOOP;

  RETURN _conv;
END;
$$;

-- 5. Add members
CREATE OR REPLACE FUNCTION public.add_group_members(_conv uuid, _user_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
  _id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_group_admin(_conv, _me) THEN
    RAISE EXCEPTION 'Only owners/admins can add members';
  END IF;
  FOREACH _id IN ARRAY _user_ids LOOP
    IF _id = _me THEN CONTINUE; END IF;
    -- Friendship check between caller and the invitee
    IF NOT EXISTS (
      SELECT 1 FROM public.friend_requests
      WHERE status = 'accepted'
        AND ((sender_id = _me AND receiver_id = _id) OR (sender_id = _id AND receiver_id = _me))
    ) THEN
      RAISE EXCEPTION 'You can only add your friends';
    END IF;
    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (_conv, _id, 'member')
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

-- 6. Remove member
CREATE OR REPLACE FUNCTION public.remove_group_member(_conv uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
  _target_role text;
  _my_role text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _my_role FROM public.conversation_members WHERE conversation_id = _conv AND user_id = _me;
  IF _my_role IS NULL OR _my_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Only owners/admins can remove members';
  END IF;
  SELECT role INTO _target_role FROM public.conversation_members WHERE conversation_id = _conv AND user_id = _user_id;
  IF _target_role IS NULL THEN RETURN; END IF;
  IF _target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the owner';
  END IF;
  IF _target_role = 'admin' AND _my_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the owner can remove an admin';
  END IF;
  DELETE FROM public.conversation_members WHERE conversation_id = _conv AND user_id = _user_id;
END;
$$;

-- 7. Set role
CREATE OR REPLACE FUNCTION public.set_member_role(_conv uuid, _user_id uuid, _role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _role NOT IN ('admin','member') THEN
    RAISE EXCEPTION 'Role must be admin or member';
  END IF;
  IF NOT public.is_group_owner(_conv, _me) THEN
    RAISE EXCEPTION 'Only the owner can change roles';
  END IF;
  IF _user_id = _me THEN
    RAISE EXCEPTION 'Use transfer_group_ownership to change your own role';
  END IF;
  UPDATE public.conversation_members
  SET role = _role
  WHERE conversation_id = _conv AND user_id = _user_id AND role <> 'owner';
END;
$$;

-- 8. Transfer ownership
CREATE OR REPLACE FUNCTION public.transfer_group_ownership(_conv uuid, _new_owner uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_group_owner(_conv, _me) THEN
    RAISE EXCEPTION 'Only the owner can transfer ownership';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversation_members WHERE conversation_id = _conv AND user_id = _new_owner) THEN
    RAISE EXCEPTION 'Target is not a member';
  END IF;
  UPDATE public.conversation_members SET role = 'admin' WHERE conversation_id = _conv AND user_id = _me;
  UPDATE public.conversation_members SET role = 'owner' WHERE conversation_id = _conv AND user_id = _new_owner;
END;
$$;

-- 9. Leave group (auto-transfer ownership if needed)
CREATE OR REPLACE FUNCTION public.leave_group(_conv uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
  _my_role text;
  _heir uuid;
  _remaining int;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _my_role FROM public.conversation_members WHERE conversation_id = _conv AND user_id = _me;
  IF _my_role IS NULL THEN RETURN; END IF;

  IF _my_role = 'owner' THEN
    SELECT user_id INTO _heir
    FROM public.conversation_members
    WHERE conversation_id = _conv AND user_id <> _me
    ORDER BY (role = 'admin') DESC, joined_at ASC
    LIMIT 1;
    IF _heir IS NOT NULL THEN
      UPDATE public.conversation_members SET role = 'owner' WHERE conversation_id = _conv AND user_id = _heir;
    END IF;
  END IF;

  DELETE FROM public.conversation_members WHERE conversation_id = _conv AND user_id = _me;

  SELECT count(*) INTO _remaining FROM public.conversation_members WHERE conversation_id = _conv;
  IF _remaining = 0 THEN
    DELETE FROM public.conversations WHERE id = _conv;
  END IF;
END;
$$;

-- 10. Rename group
CREATE OR REPLACE FUNCTION public.rename_group(_conv uuid, _name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_group_admin(_conv, _me) THEN
    RAISE EXCEPTION 'Only owners/admins can rename';
  END IF;
  IF _name IS NULL OR length(trim(_name)) = 0 THEN
    RAISE EXCEPTION 'Name required';
  END IF;
  UPDATE public.conversations SET name = trim(_name), updated_at = now() WHERE id = _conv AND is_group = true;
END;
$$;

-- 11. List user's groups
CREATE OR REPLACE FUNCTION public.get_user_group_list()
RETURNS TABLE(
  conversation_id uuid,
  name text,
  member_count bigint,
  my_role text,
  unread_count bigint,
  last_message_at timestamptz,
  is_pinned boolean,
  member_previews jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH my_groups AS (
    SELECT c.id, c.name, cm.role
    FROM public.conversations c
    JOIN public.conversation_members cm ON cm.conversation_id = c.id
    WHERE c.is_group = true AND cm.user_id = auth.uid()
  ),
  counts AS (
    SELECT conversation_id, count(*) AS n
    FROM public.conversation_members
    WHERE conversation_id IN (SELECT id FROM my_groups)
    GROUP BY conversation_id
  ),
  unread AS (
    SELECT m.conversation_id, count(*) AS cnt
    FROM public.messages m
    WHERE m.conversation_id IN (SELECT id FROM my_groups)
      AND m.sender_id <> auth.uid()
      AND m.read_at IS NULL
    GROUP BY m.conversation_id
  ),
  last_msg AS (
    SELECT m.conversation_id, max(m.created_at) AS last_at
    FROM public.messages m
    WHERE m.conversation_id IN (SELECT id FROM my_groups)
    GROUP BY m.conversation_id
  ),
  pins AS (
    SELECT conversation_id FROM public.pinned_conversations WHERE user_id = auth.uid()
  ),
  previews AS (
    SELECT g.id AS conversation_id,
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'username', p.username,
          'display_name', p.display_name,
          'avatar_url', p.avatar_url
        ) ORDER BY cm.joined_at
      ) FILTER (WHERE p.id IS NOT NULL) AS previews
    FROM my_groups g
    JOIN public.conversation_members cm ON cm.conversation_id = g.id
    JOIN public.profiles p ON p.id = cm.user_id
    GROUP BY g.id
  )
  SELECT
    g.id AS conversation_id,
    g.name,
    COALESCE(c.n, 0) AS member_count,
    g.role AS my_role,
    COALESCE(u.cnt, 0) AS unread_count,
    COALESCE(lm.last_at, (SELECT created_at FROM public.conversations WHERE id = g.id)) AS last_message_at,
    (pn.conversation_id IS NOT NULL) AS is_pinned,
    COALESCE(pr.previews, '[]'::jsonb) AS member_previews
  FROM my_groups g
  LEFT JOIN counts c ON c.conversation_id = g.id
  LEFT JOIN unread u ON u.conversation_id = g.id
  LEFT JOIN last_msg lm ON lm.conversation_id = g.id
  LEFT JOIN pins pn ON pn.conversation_id = g.id
  LEFT JOIN previews pr ON pr.conversation_id = g.id
  ORDER BY (pn.conversation_id IS NOT NULL) DESC, last_message_at DESC NULLS LAST;
$$;
