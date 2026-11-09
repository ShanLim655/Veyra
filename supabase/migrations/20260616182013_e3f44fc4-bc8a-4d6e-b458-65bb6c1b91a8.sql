
CREATE TABLE IF NOT EXISTS public.pinned_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, conversation_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pinned_conversations TO authenticated;
GRANT ALL ON public.pinned_conversations TO service_role;

ALTER TABLE public.pinned_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own pins" ON public.pinned_conversations;
CREATE POLICY "Users manage their own pins"
ON public.pinned_conversations FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_pinned_conv_user ON public.pinned_conversations(user_id);

DROP FUNCTION IF EXISTS public.get_user_dm_list();

CREATE FUNCTION public.get_user_dm_list()
RETURNS TABLE (
  conversation_id uuid,
  other_user_id uuid,
  other_username text,
  other_display_name text,
  other_avatar_url text,
  other_status text,
  unread_count bigint,
  last_message_at timestamptz,
  friend_request_id uuid,
  is_pinned boolean
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
  ),
  pins AS (
    SELECT conversation_id FROM public.pinned_conversations WHERE user_id = auth.uid()
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
    fr.id AS friend_request_id,
    (pn.conversation_id IS NOT NULL) AS is_pinned
  FROM others o
  JOIN public.profiles p ON p.id = o.other_user_id
  LEFT JOIN unread u ON u.conversation_id = o.conversation_id
  LEFT JOIN last_msg lm ON lm.conversation_id = o.conversation_id
  LEFT JOIN pins pn ON pn.conversation_id = o.conversation_id
  LEFT JOIN LATERAL (
    SELECT id FROM public.friend_requests
    WHERE status = 'accepted'
      AND ((sender_id = auth.uid() AND receiver_id = o.other_user_id)
        OR (sender_id = o.other_user_id AND receiver_id = auth.uid()))
    LIMIT 1
  ) fr ON true
  ORDER BY (pn.conversation_id IS NOT NULL) DESC, last_message_at DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_dm_list() TO authenticated;
