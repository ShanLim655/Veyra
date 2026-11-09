-- Create global_messages table for public chat
CREATE TABLE public.global_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.global_messages ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view global messages
CREATE POLICY "Authenticated users can view global messages"
ON public.global_messages
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Authenticated users can send global messages
CREATE POLICY "Authenticated users can send global messages"
ON public.global_messages
FOR INSERT
WITH CHECK (auth.uid() = sender_id);

-- Users can delete their own global messages
CREATE POLICY "Users can delete own global messages"
ON public.global_messages
FOR DELETE
USING (auth.uid() = sender_id);

-- Add trigger for updated_at
CREATE TRIGGER update_global_messages_updated_at
BEFORE UPDATE ON public.global_messages
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for global_messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.global_messages;