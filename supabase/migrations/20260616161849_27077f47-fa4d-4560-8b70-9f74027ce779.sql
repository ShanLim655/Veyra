
CREATE TRIGGER notify_ntfy_on_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_ntfy('dm');

CREATE TRIGGER notify_ntfy_on_global_message
  AFTER INSERT ON public.global_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_ntfy('global');

CREATE TRIGGER notify_ntfy_on_announcement
  AFTER INSERT ON public.announcement_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_ntfy('announcement');
