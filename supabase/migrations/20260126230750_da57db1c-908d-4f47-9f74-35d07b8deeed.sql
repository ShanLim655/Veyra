-- Add pinned message columns to messages table (for DMs)
ALTER TABLE public.messages ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN pinned_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.messages ADD COLUMN pinned_by UUID REFERENCES auth.users(id);

-- Add pinned message columns to announcement_messages table
ALTER TABLE public.announcement_messages ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.announcement_messages ADD COLUMN pinned_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.announcement_messages ADD COLUMN pinned_by UUID REFERENCES auth.users(id);

-- Create index for efficient pinned message queries
CREATE INDEX idx_messages_pinned ON public.messages(conversation_id, is_pinned) WHERE is_pinned = true;
CREATE INDEX idx_announcement_messages_pinned ON public.announcement_messages(is_pinned) WHERE is_pinned = true;