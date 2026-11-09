
-- ============ polls ============
CREATE TABLE public.polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('dm','global','announcements')),
  conversation_id uuid NULL,
  message_id uuid NULL,
  question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 300),
  multiple_choice boolean NOT NULL DEFAULT false,
  ends_at timestamptz NOT NULL,
  closed_at timestamptz NULL,
  result_message_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.polls TO authenticated;
GRANT ALL ON public.polls TO service_role;
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view polls in accessible channels"
ON public.polls FOR SELECT TO authenticated
USING (
  channel IN ('global','announcements')
  OR (channel = 'dm' AND conversation_id IS NOT NULL AND public.is_conversation_member(conversation_id, auth.uid()))
);

CREATE POLICY "create polls"
ON public.polls FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    channel = 'global'
    OR (channel = 'announcements' AND public.is_admin_or_super(auth.uid()))
    OR (channel = 'dm' AND conversation_id IS NOT NULL AND public.is_conversation_member(conversation_id, auth.uid()))
  )
);

CREATE POLICY "creator updates own poll"
ON public.polls FOR UPDATE TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

CREATE POLICY "creator or admin deletes poll"
ON public.polls FOR DELETE TO authenticated
USING (created_by = auth.uid() OR public.is_admin_or_super(auth.uid()));

CREATE TRIGGER polls_updated_at BEFORE UPDATE ON public.polls
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ poll_options ============
CREATE TABLE public.poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  position int NOT NULL,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 150),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, position)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.poll_options TO authenticated;
GRANT ALL ON public.poll_options TO service_role;
ALTER TABLE public.poll_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view options when poll visible"
ON public.poll_options FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.polls p WHERE p.id = poll_id));

CREATE POLICY "creator inserts options"
ON public.poll_options FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.polls p WHERE p.id = poll_id AND p.created_by = auth.uid()));

CREATE POLICY "creator deletes options"
ON public.poll_options FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.polls p WHERE p.id = poll_id AND p.created_by = auth.uid()));

-- ============ poll_votes ============
CREATE TABLE public.poll_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES public.poll_options(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (option_id, user_id)
);
CREATE INDEX poll_votes_poll_idx ON public.poll_votes(poll_id);
CREATE INDEX poll_votes_user_idx ON public.poll_votes(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.poll_votes TO authenticated;
GRANT ALL ON public.poll_votes TO service_role;
ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view votes when poll visible"
ON public.poll_votes FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.polls p WHERE p.id = poll_id));

CREATE POLICY "cast own vote when poll open"
ON public.poll_votes FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.polls p
    WHERE p.id = poll_id
      AND p.closed_at IS NULL
      AND p.ends_at > now()
  )
);

CREATE POLICY "delete own vote when poll open"
ON public.poll_votes FOR DELETE TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.polls p
    WHERE p.id = poll_id
      AND p.closed_at IS NULL
      AND p.ends_at > now()
  )
);

-- Enforce single-choice by removing previous votes for same user/poll
CREATE OR REPLACE FUNCTION public.enforce_single_choice_vote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _multi boolean;
BEGIN
  SELECT multiple_choice INTO _multi FROM public.polls WHERE id = NEW.poll_id;
  IF NOT _multi THEN
    DELETE FROM public.poll_votes
    WHERE poll_id = NEW.poll_id
      AND user_id = NEW.user_id
      AND option_id <> NEW.option_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER poll_votes_single_choice
BEFORE INSERT ON public.poll_votes
FOR EACH ROW EXECUTE FUNCTION public.enforce_single_choice_vote();

-- ============ finalize_poll ============
CREATE OR REPLACE FUNCTION public.finalize_poll(_poll_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _p record;
  _total int;
  _result_text text;
  _winners text;
  _new_msg_id uuid;
BEGIN
  SELECT * INTO _p FROM public.polls WHERE id = _poll_id;
  IF _p IS NULL THEN RETURN NULL; END IF;
  IF _p.result_message_id IS NOT NULL THEN RETURN _p.result_message_id; END IF;
  IF _p.ends_at > now() AND _p.closed_at IS NULL THEN RETURN NULL; END IF;

  SELECT COUNT(*) INTO _total FROM public.poll_votes WHERE poll_id = _poll_id;

  WITH counts AS (
    SELECT o.id, o.text, COUNT(v.id) AS c
    FROM public.poll_options o
    LEFT JOIN public.poll_votes v ON v.option_id = o.id
    WHERE o.poll_id = _poll_id
    GROUP BY o.id, o.text
  ),
  mx AS (SELECT COALESCE(MAX(c),0) AS m FROM counts)
  SELECT string_agg('"' || text || '" (' || c || ')', ', ' ORDER BY text)
  INTO _winners
  FROM counts, mx
  WHERE counts.c = mx.m AND mx.m > 0;

  _result_text := '📊 Poll ended: "' || _p.question || '" — '
    || COALESCE('Winner: ' || _winners, 'No votes')
    || ' • ' || _total || ' vote(s)';

  IF _p.channel = 'dm' AND _p.conversation_id IS NOT NULL THEN
    INSERT INTO public.messages (conversation_id, sender_id, content)
    VALUES (_p.conversation_id, _p.created_by, _result_text)
    RETURNING id INTO _new_msg_id;
  ELSIF _p.channel = 'global' THEN
    INSERT INTO public.global_messages (sender_id, content)
    VALUES (_p.created_by, _result_text)
    RETURNING id INTO _new_msg_id;
  ELSIF _p.channel = 'announcements' THEN
    INSERT INTO public.announcement_messages (sender_id, content)
    VALUES (_p.created_by, _result_text)
    RETURNING id INTO _new_msg_id;
  END IF;

  UPDATE public.polls
  SET result_message_id = _new_msg_id,
      closed_at = COALESCE(closed_at, now())
  WHERE id = _poll_id;

  RETURN _new_msg_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.finalize_poll(uuid) TO authenticated;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.polls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.poll_options;
ALTER PUBLICATION supabase_realtime ADD TABLE public.poll_votes;
