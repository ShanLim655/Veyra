ALTER TABLE public.messages 
ADD COLUMN read_at timestamp with time zone DEFAULT NULL;

ALTER TABLE public.messages 
ADD COLUMN edited_at timestamp with time zone DEFAULT NULL;