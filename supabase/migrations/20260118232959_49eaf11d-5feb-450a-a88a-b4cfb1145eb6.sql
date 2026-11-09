-- Create storage bucket for chat videos
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-videos', 'chat-videos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload videos
CREATE POLICY "Users can upload chat videos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'chat-videos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow public to view chat videos
CREATE POLICY "Anyone can view chat videos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'chat-videos');

-- Allow users to delete their own videos
CREATE POLICY "Users can delete their own chat videos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'chat-videos' AND auth.uid()::text = (storage.foldername(name))[1]);