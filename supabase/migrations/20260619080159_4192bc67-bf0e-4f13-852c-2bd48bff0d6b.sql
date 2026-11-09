ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username_set boolean NOT NULL DEFAULT false;

-- Existing users are considered already set
UPDATE public.profiles SET username_set = true WHERE username_set = false;

-- Update signup trigger to read the flag from auth metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, username_set)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data ->> 'username_set')::boolean, false)
  );
  RETURN NEW;
END;
$function$;