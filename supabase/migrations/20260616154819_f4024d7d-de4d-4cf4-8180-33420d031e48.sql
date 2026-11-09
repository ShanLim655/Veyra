
DROP TRIGGER IF EXISTS messages_notify_ntfy ON public.messages;
CREATE TRIGGER messages_notify_ntfy
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.notify_ntfy('dm');

DROP TRIGGER IF EXISTS global_messages_notify_ntfy ON public.global_messages;
CREATE TRIGGER global_messages_notify_ntfy
AFTER INSERT ON public.global_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_ntfy('global');

DROP TRIGGER IF EXISTS announcement_messages_notify_ntfy ON public.announcement_messages;
CREATE TRIGGER announcement_messages_notify_ntfy
AFTER INSERT ON public.announcement_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_ntfy('announcement');
