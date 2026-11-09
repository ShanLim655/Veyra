-- Drop the restrictive policy and recreate as permissive
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;

-- Create a permissive policy so users can view their own role
CREATE POLICY "Users can view their own roles" 
ON public.user_roles 
FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);