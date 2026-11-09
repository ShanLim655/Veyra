DROP POLICY IF EXISTS "Users can view members of their conversations" ON public.conversation_members;
DROP POLICY IF EXISTS "Users can add members to conversations they're in" ON public.conversation_members;
DROP POLICY IF EXISTS "Users can view their conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can update their group conversations" ON public.conversations;

CREATE OR REPLACE FUNCTION public.is_conversation_member(_conversation_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_members
    WHERE conversation_id = _conversation_id
      AND user_id = _user_id
  )
$$;

CREATE POLICY "Users can view members of their conversations"
ON public.conversation_members
FOR SELECT
USING (public.is_conversation_member(conversation_id, auth.uid()));

CREATE POLICY "Users can add members to conversations they're in"
ON public.conversation_members
FOR INSERT
WITH CHECK (
  public.is_conversation_member(conversation_id, auth.uid()) 
  OR user_id = auth.uid()
);

CREATE POLICY "Users can view their conversations"
ON public.conversations
FOR SELECT
USING (public.is_conversation_member(id, auth.uid()));

CREATE POLICY "Users can update their group conversations"
ON public.conversations
FOR UPDATE
USING (public.is_conversation_member(id, auth.uid()));