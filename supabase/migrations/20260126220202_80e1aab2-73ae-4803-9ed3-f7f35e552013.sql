-- Add reply_to_id and edited_at columns to global_messages for reply and edit functionality
ALTER TABLE public.global_messages 
ADD COLUMN reply_to_id uuid REFERENCES public.global_messages(id) ON DELETE SET NULL,
ADD COLUMN edited_at timestamp with time zone;

-- Add UPDATE policy so users can edit their own global messages
CREATE POLICY "Users can update own global messages"
ON public.global_messages
FOR UPDATE
USING (auth.uid() = sender_id);