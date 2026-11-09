-- Create the is_admin_or_super security definer function
CREATE OR REPLACE FUNCTION public.is_admin_or_super(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin', 'super_admin')
  )
$$;

-- Create announcement_messages table
CREATE TABLE public.announcement_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  reply_to_id UUID REFERENCES public.announcement_messages(id) ON DELETE SET NULL,
  edited_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.announcement_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- All authenticated users can view announcements
CREATE POLICY "Authenticated users can view announcements"
ON public.announcement_messages
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Only admins/super_admins can send announcements
CREATE POLICY "Admins can send announcements"
ON public.announcement_messages
FOR INSERT
WITH CHECK (is_admin_or_super(auth.uid()) AND auth.uid() = sender_id);

-- Sender or super_admin can update announcements
CREATE POLICY "Users can update own announcements"
ON public.announcement_messages
FOR UPDATE
USING (auth.uid() = sender_id);

CREATE POLICY "Super admins can update any announcement"
ON public.announcement_messages
FOR UPDATE
USING (is_super_admin(auth.uid()));

-- Sender or super_admin can delete announcements
CREATE POLICY "Users can delete own announcements"
ON public.announcement_messages
FOR DELETE
USING (auth.uid() = sender_id);

CREATE POLICY "Super admins can delete any announcement"
ON public.announcement_messages
FOR DELETE
USING (is_super_admin(auth.uid()));

-- Create trigger for updated_at
CREATE TRIGGER update_announcement_messages_updated_at
BEFORE UPDATE ON public.announcement_messages
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.announcement_messages;