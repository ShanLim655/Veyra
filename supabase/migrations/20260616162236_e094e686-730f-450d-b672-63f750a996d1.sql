
-- Drop ALL existing ntfy triggers on the three message tables
DROP TRIGGER IF EXISTS ntfy_after_dm ON public.messages;
DROP TRIGGER IF EXISTS messages_notify_ntfy ON public.messages;
DROP TRIGGER IF EXISTS notify_ntfy_dm_message ON public.messages;
DROP TRIGGER IF EXISTS notify_ntfy_on_message ON public.messages;

DROP TRIGGER IF EXISTS ntfy_after_global ON public.global_messages;
DROP TRIGGER IF EXISTS global_messages_notify_ntfy ON public.global_messages;
DROP TRIGGER IF EXISTS notify_ntfy_global_message ON public.global_messages;
DROP TRIGGER IF EXISTS notify_ntfy_on_global_message ON public.global_messages;

DROP TRIGGER IF EXISTS ntfy_after_announcement ON public.announcement_messages;
DROP TRIGGER IF EXISTS announcement_messages_notify_ntfy ON public.announcement_messages;
DROP TRIGGER IF EXISTS notify_ntfy_announcement_message ON public.announcement_messages;
DROP TRIGGER IF EXISTS notify_ntfy_on_announcement ON public.announcement_messages;

-- Recreate exactly one trigger per table
CREATE TRIGGER ntfy_on_message_insert
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_ntfy('dm');

CREATE TRIGGER ntfy_on_global_message_insert
  AFTER INSERT ON public.global_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_ntfy('global');

CREATE TRIGGER ntfy_on_announcement_message_insert
  AFTER INSERT ON public.announcement_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_ntfy('announcement');
