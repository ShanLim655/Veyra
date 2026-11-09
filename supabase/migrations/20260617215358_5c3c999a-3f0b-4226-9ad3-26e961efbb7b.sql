CREATE POLICY "Banner images are publicly readable"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'banners');