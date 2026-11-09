-- Create enum for admin roles
CREATE TYPE public.app_role AS ENUM ('user', 'admin', 'super_admin');

-- Create user_roles table
CREATE TABLE public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'user',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create function to check if user has super_admin role
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'super_admin'
  )
$$;

-- RLS policies for user_roles table
CREATE POLICY "Users can view their own roles"
ON public.user_roles FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Super admins can view all roles"
ON public.user_roles FOR SELECT
USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins can manage roles"
ON public.user_roles FOR ALL
USING (public.is_super_admin(auth.uid()));

-- Update global_messages policies for super_admin moderation
CREATE POLICY "Super admins can update any global message"
ON public.global_messages FOR UPDATE
USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins can delete any global message"
ON public.global_messages FOR DELETE
USING (public.is_super_admin(auth.uid()));

-- Update messages policies for super_admin to view and edit all DMs
CREATE POLICY "Super admins can view all messages"
ON public.messages FOR SELECT
USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins can update any message"
ON public.messages FOR UPDATE
USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins can delete any message"
ON public.messages FOR DELETE
USING (public.is_super_admin(auth.uid()));

-- Update conversations policies for super_admin to view all
CREATE POLICY "Super admins can view all conversations"
ON public.conversations FOR SELECT
USING (public.is_super_admin(auth.uid()));

-- Update conversation_members policies for super_admin
CREATE POLICY "Super admins can view all conversation members"
ON public.conversation_members FOR SELECT
USING (public.is_super_admin(auth.uid()));