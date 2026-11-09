
DROP POLICY IF EXISTS "Users can upload chat images" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload chat videos" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload voice messages" ON storage.objects;

CREATE POLICY "Users can upload chat images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-images'
  AND (auth.uid())::text = (storage.foldername(name))[1]
  AND (
    (storage.foldername(name))[2] = ANY (ARRAY['global','announcements'])
    OR (
      (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND public.is_conversation_member(((storage.foldername(name))[2])::uuid, auth.uid())
    )
  )
);

CREATE POLICY "Users can upload chat videos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-videos'
  AND (auth.uid())::text = (storage.foldername(name))[1]
  AND (
    (storage.foldername(name))[2] = ANY (ARRAY['global','announcements'])
    OR (
      (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND public.is_conversation_member(((storage.foldername(name))[2])::uuid, auth.uid())
    )
  )
);

CREATE POLICY "Users can upload voice messages"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-voice'
  AND (auth.uid())::text = (storage.foldername(name))[1]
  AND (
    (storage.foldername(name))[2] = ANY (ARRAY['global','announcements'])
    OR (
      (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND public.is_conversation_member(((storage.foldername(name))[2])::uuid, auth.uid())
    )
  )
);
