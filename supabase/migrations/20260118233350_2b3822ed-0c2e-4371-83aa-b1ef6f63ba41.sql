-- Create storage bucket for voice messages
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-voice', 'chat-voice', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload voice messages
CREATE POLICY "Users can upload voice messages"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'chat-voice' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow public to listen to voice messages
CREATE POLICY "Anyone can listen to voice messages"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'chat-voice');

-- Allow users to delete their own voice messages
CREATE POLICY "Users can delete their own voice messages"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'chat-voice' AND auth.uid()::text = (storage.foldername(name))[1]);