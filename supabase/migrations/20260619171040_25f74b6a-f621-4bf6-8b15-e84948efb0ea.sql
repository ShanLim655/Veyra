
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS allow_friend_requests boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.accepts_friend_requests(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT allow_friend_requests FROM public.profiles WHERE id = _user_id), true);
$$;

GRANT EXECUTE ON FUNCTION public.accepts_friend_requests(uuid) TO authenticated;

DROP POLICY IF EXISTS "Users can send friend requests" ON public.friend_requests;
CREATE POLICY "Users can send friend requests"
ON public.friend_requests
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = sender_id
  AND sender_id <> receiver_id
  AND public.accepts_friend_requests(receiver_id)
);
