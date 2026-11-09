DROP TRIGGER IF EXISTS notify_ntfy_dm_message ON public.messages;
DROP TRIGGER IF EXISTS notify_ntfy_global_message ON public.global_messages;
DROP TRIGGER IF EXISTS notify_ntfy_announcement_message ON public.announcement_messages;

CREATE TRIGGER notify_ntfy_dm_message
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_ntfy('dm');

CREATE TRIGGER notify_ntfy_global_message
AFTER INSERT ON public.global_messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_ntfy('global');

CREATE TRIGGER notify_ntfy_announcement_message
AFTER INSERT ON public.announcement_messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_ntfy('announcement');