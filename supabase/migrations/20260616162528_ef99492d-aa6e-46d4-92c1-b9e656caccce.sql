DROP TRIGGER IF EXISTS notify_ntfy_on_message ON public.messages;
DROP TRIGGER IF EXISTS notify_ntfy_on_global_message ON public.global_messages;
DROP TRIGGER IF EXISTS notify_ntfy_on_announcement ON public.announcement_messages;
DROP TRIGGER IF EXISTS ntfy_on_message_insert ON public.messages;
DROP TRIGGER IF EXISTS ntfy_on_global_message_insert ON public.global_messages;
DROP TRIGGER IF EXISTS ntfy_on_announcement_message_insert ON public.announcement_messages;

CREATE TRIGGER ntfy_on_message_insert
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_ntfy('dm');

CREATE TRIGGER ntfy_on_global_message_insert
AFTER INSERT ON public.global_messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_ntfy('global');

CREATE TRIGGER ntfy_on_announcement_message_insert
AFTER INSERT ON public.announcement_messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_ntfy('announcement');