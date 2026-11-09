ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio text, ADD COLUMN IF NOT EXISTS pronouns text;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_bio_length CHECK (bio IS NULL OR char_length(bio) <= 500);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pronouns_length CHECK (pronouns IS NULL OR char_length(pronouns) <= 30);