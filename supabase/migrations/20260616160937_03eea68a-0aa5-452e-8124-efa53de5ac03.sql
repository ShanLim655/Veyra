CREATE TABLE IF NOT EXISTS public.notification_trigger_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('dm', 'global', 'announcement')),
  message_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.notification_trigger_events TO service_role;

ALTER TABLE public.notification_trigger_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_notification_trigger_events_token
ON public.notification_trigger_events(token);

CREATE INDEX IF NOT EXISTS idx_notification_trigger_events_created_at
ON public.notification_trigger_events(created_at);

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