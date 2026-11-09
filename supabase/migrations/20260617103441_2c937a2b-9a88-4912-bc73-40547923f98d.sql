
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

CREATE OR REPLACE FUNCTION public.mark_message_delivered(_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _conv uuid;
  _sender uuid;
BEGIN
  SELECT conversation_id, sender_id INTO _conv, _sender
  FROM public.messages WHERE id = _message_id;

  IF _conv IS NULL THEN RETURN; END IF;
  IF _sender = auth.uid() THEN RETURN; END IF;
  IF NOT public.is_conversation_member(_conv, auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.messages
  SET delivered_at = COALESCE(delivered_at, now())
  WHERE id = _message_id;
END;
$$;

-- Bulk-mark delivered for all undelivered messages in a conversation for the caller (recipient)
CREATE OR REPLACE FUNCTION public.mark_conversation_delivered(_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_conversation_member(_conversation_id, auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.messages
  SET delivered_at = now()
  WHERE conversation_id = _conversation_id
    AND sender_id <> auth.uid()
    AND delivered_at IS NULL;
END;
$$;
