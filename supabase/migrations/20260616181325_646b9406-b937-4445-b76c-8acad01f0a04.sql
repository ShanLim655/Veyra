
-- 1) Privilege escalation: explicit RESTRICTIVE policies so only super admins can write to user_roles
CREATE POLICY "Only super admins can insert roles"
ON public.user_roles AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Only super admins can update roles"
ON public.user_roles AS RESTRICTIVE FOR UPDATE TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Only super admins can delete roles"
ON public.user_roles AS RESTRICTIVE FOR DELETE TO authenticated
USING (public.is_super_admin(auth.uid()));

-- 2) Lock down SECURITY DEFINER internal helpers from direct execution by clients.
-- These are used inside RLS policies / triggers and do not need to be callable directly.
REVOKE EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_super(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_deletion() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_dm_on_friend_accept() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_ntfy() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- 3) Tighten storage listing on chat buckets to the uploader's own folder
DROP POLICY IF EXISTS "Authenticated can list chat images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can list chat videos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can list voice messages" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can list avatars" ON storage.objects;

CREATE POLICY "Users can list their own chat images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-images' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can list their own chat videos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-videos' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can list their own voice messages"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-voice' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- Avatars: allow authenticated to list (they are profile pictures shown across the app)
CREATE POLICY "Authenticated can list avatars"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'avatars');

-- 4) Realtime: restrict private presence channel subscriptions to conversation members
-- Topic format used by app: presence:{conversation_id} and global-presence
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated realtime access" ON realtime.messages;
CREATE POLICY "Authenticated realtime access"
ON realtime.messages FOR SELECT TO authenticated
USING (
  CASE
    WHEN realtime.topic() LIKE 'presence:%' THEN
      public.is_conversation_member(
        NULLIF(substring(realtime.topic() FROM 'presence:(.*)'), '')::uuid,
        auth.uid()
      )
    ELSE true
  END
);

DROP POLICY IF EXISTS "Authenticated realtime write" ON realtime.messages;
CREATE POLICY "Authenticated realtime write"
ON realtime.messages FOR INSERT TO authenticated
WITH CHECK (
  CASE
    WHEN realtime.topic() LIKE 'presence:%' THEN
      public.is_conversation_member(
        NULLIF(substring(realtime.topic() FROM 'presence:(.*)'), '')::uuid,
        auth.uid()
      )
    ELSE true
  END
);

-- 5) Clean up hardcoded trigger secret reference (function already rewritten in a later migration,
-- but redefine here to guarantee the literal is not present in the current function body).
CREATE OR REPLACE FUNCTION public.notify_ntfy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  fn_url text := 'https://ikrdlyuniuphcqtdkqnv.supabase.co/functions/v1/send-ntfy';
  channel text := TG_ARGV[0];
  convo_id uuid := NULL;
  payload jsonb;
  trigger_event_id uuid;
  trigger_token uuid;
BEGIN
  IF channel = 'dm' THEN
    convo_id := NEW.conversation_id;
  END IF;

  INSERT INTO public.notification_trigger_events (channel, message_id)
  VALUES (channel, NEW.id)
  RETURNING id, token INTO trigger_event_id, trigger_token;

  payload := jsonb_build_object(
    'channel', channel,
    'message_id', NEW.id,
    'sender_id', NEW.sender_id,
    'content', NEW.content,
    'conversation_id', convo_id,
    'trigger_event_id', trigger_event_id,
    'trigger_token', trigger_token
  );

  PERFORM net.http_post(
    url := fn_url,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := payload
  );
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notify_ntfy() FROM PUBLIC, anon, authenticated;
