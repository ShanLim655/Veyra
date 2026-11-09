
CREATE OR REPLACE FUNCTION public.get_user_dm_list()
RETURNS TABLE (
  conversation_id uuid,
  other_user_id uuid,
  other_username text,
  other_display_name text,
  other_avatar_url text,
  other_status text,
  unread_count bigint,
  last_message_at timestamptz,
  friend_request_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH my_convs AS (
    SELECT cm.conversation_id
    FROM public.conversation_members cm
    JOIN public.conversations c ON c.id = cm.conversation_id
    WHERE cm.user_id = auth.uid() AND c.is_group = false
  ),
  others AS (
    SELECT cm.conversation_id, cm.user_id AS other_user_id
    FROM public.conversation_members cm
    WHERE cm.conversation_id IN (SELECT conversation_id FROM my_convs)
      AND cm.user_id <> auth.uid()
  ),
  unread AS (
    SELECT m.conversation_id, COUNT(*) AS cnt
    FROM public.messages m
    WHERE m.conversation_id IN (SELECT conversation_id FROM my_convs)
      AND m.sender_id <> auth.uid()
      AND m.read_at IS NULL
    GROUP BY m.conversation_id
  ),
  last_msg AS (
    SELECT m.conversation_id, MAX(m.created_at) AS last_at
    FROM public.messages m
    WHERE m.conversation_id IN (SELECT conversation_id FROM my_convs)
    GROUP BY m.conversation_id
  )
  SELECT
    o.conversation_id,
    o.other_user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.status,
    COALESCE(u.cnt, 0) AS unread_count,
    COALESCE(lm.last_at, (SELECT created_at FROM public.conversations WHERE id = o.conversation_id)) AS last_message_at,
    fr.id AS friend_request_id
  FROM others o
  JOIN public.profiles p ON p.id = o.other_user_id
  LEFT JOIN unread u ON u.conversation_id = o.conversation_id
  LEFT JOIN last_msg lm ON lm.conversation_id = o.conversation_id
  LEFT JOIN LATERAL (
    SELECT id FROM public.friend_requests
    WHERE status = 'accepted'
      AND ((sender_id = auth.uid() AND receiver_id = o.other_user_id)
        OR (sender_id = o.other_user_id AND receiver_id = auth.uid()))
    LIMIT 1
  ) fr ON true
  ORDER BY last_message_at DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_dm_list() TO authenticated;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON public.messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conv_unread ON public.messages(conversation_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON public.conversation_members(user_id);
