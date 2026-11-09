-- Add DELETE policy for friend_requests so users can unfriend
-- Allow deletion if user is either the sender or receiver of the friend request
CREATE POLICY "Users can delete their friend requests"
ON public.friend_requests
FOR DELETE
USING (auth.uid() = sender_id OR auth.uid() = receiver_id);