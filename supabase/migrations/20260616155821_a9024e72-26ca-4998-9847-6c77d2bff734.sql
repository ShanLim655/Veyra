
-- 1) Remove broad "mark as read" UPDATE policy; replace with RPC
DROP POLICY IF EXISTS "Users can mark messages as read in their conversations" ON public.messages;

CREATE OR REPLACE FUNCTION public.mark_message_read(_message_id uuid)
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

  IF _conv IS NULL THEN
    RETURN;
  END IF;

  IF _sender = auth.uid() THEN
    RETURN; -- senders don't mark their own
  END IF;

  IF NOT public.is_conversation_member(_conv, auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.messages
  SET read_at = COALESCE(read_at, now())
  WHERE id = _message_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_message_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_message_read(uuid) TO authenticated;

-- 2) Scope chat-images uploads to user folder
DROP POLICY IF EXISTS "Users can upload chat images" ON storage.objects;
CREATE POLICY "Users can upload chat images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'chat-images'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

-- 3) Add trigger-secret check to notify_ntfy()
CREATE OR REPLACE FUNCTION public.notify_ntfy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  fn_url text := 'https://ikrdlyuniuphcqtdkqnv.supabase.co/functions/v1/send-ntfy';
  channel text := TG_ARGV[0];
  convo_id uuid := NULL;
  payload jsonb;
  trigger_secret text := 'eb29d971e2135cc99986146af119a09957558ad71165733461dab8d7d856ebc4';
BEGIN
  IF channel = 'dm' THEN
    convo_id := NEW.conversation_id;
  END IF;

  payload := jsonb_build_object(
    'channel', channel,
    'message_id', NEW.id,
    'sender_id', NEW.sender_id,
    'content', NEW.content,
    'conversation_id', convo_id
  );

  PERFORM net.http_post(
    url := fn_url,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-trigger-secret', trigger_secret
    ),
    body := payload
  );
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notify_ntfy() FROM PUBLIC, anon, authenticated;
