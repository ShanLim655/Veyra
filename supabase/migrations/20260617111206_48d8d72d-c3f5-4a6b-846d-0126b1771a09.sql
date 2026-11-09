
-- 1. Tighten realtime.messages: deny all topics except conversation presence for members
DROP POLICY IF EXISTS "Authenticated realtime access" ON realtime.messages;
DROP POLICY IF EXISTS "Authenticated realtime write" ON realtime.messages;

CREATE POLICY "Authenticated realtime access"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    CASE
      WHEN realtime.topic() LIKE 'presence:%' THEN
        public.is_conversation_member(
          (NULLIF(substring(realtime.topic(), 'presence:(.*)'), ''))::uuid,
          auth.uid()
        )
      ELSE false
    END
  );

CREATE POLICY "Authenticated realtime write"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    CASE
      WHEN realtime.topic() LIKE 'presence:%' THEN
        public.is_conversation_member(
          (NULLIF(substring(realtime.topic(), 'presence:(.*)'), ''))::uuid,
          auth.uid()
        )
      ELSE false
    END
  );

-- 2. Replace overly-broad chat-media SELECT policies with member/channel-scoped ones
DROP POLICY IF EXISTS "Users can list their own chat images" ON storage.objects;
DROP POLICY IF EXISTS "Users can list their own chat videos" ON storage.objects;
DROP POLICY IF EXISTS "Users can list their own voice messages" ON storage.objects;

CREATE POLICY "Read chat media (sender, conversation member, or shared channel)"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id IN ('chat-images','chat-videos','chat-voice')
    AND (
      (storage.foldername(name))[1] = (auth.uid())::text
      OR (storage.foldername(name))[2] IN ('global','announcements')
      OR (
        (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        AND public.is_conversation_member(
          ((storage.foldername(name))[2])::uuid,
          auth.uid()
        )
      )
    )
  );
