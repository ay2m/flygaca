-- 0007_storage_and_account_sync.sql
-- 1. Initialize Supabase Storage 'avatars' bucket and access policies
-- 2. Enhance handle_new_auth_user() to seamlessly adopt existing user accounts by email

-- 1. Storage bucket setup (if storage schema exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('avatars', 'avatars', true)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;

-- RLS policies on storage.objects for avatars
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_public_read') THEN
      CREATE POLICY avatars_public_read ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_authenticated_insert') THEN
      CREATE POLICY avatars_authenticated_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
        bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text
      );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_authenticated_update') THEN
      CREATE POLICY avatars_authenticated_update ON storage.objects FOR UPDATE TO authenticated USING (
        bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text
      );
    END IF;
  END IF;
END
$$;

-- 2. Enhanced handle_new_auth_user() function
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_user_id text;
BEGIN
  -- Check if user already exists by email with a different ID
  SELECT id INTO existing_user_id FROM public.users WHERE email = new.email;

  IF existing_user_id IS NOT NULL AND existing_user_id <> new.id::text THEN
    -- Migrate existing user foreign keys to new auth.users id
    UPDATE public.entitlements SET user_id = new.id::text WHERE user_id = existing_user_id;
    UPDATE public.profiles SET user_id = new.id::text WHERE user_id = existing_user_id;
    UPDATE public.flights SET user_id = new.id::text WHERE user_id = existing_user_id;
    UPDATE public.pilot_records SET user_id = new.id::text WHERE user_id = existing_user_id;
    UPDATE public.study_progress SET user_id = new.id::text WHERE user_id = existing_user_id;
    UPDATE public.chat_credits SET user_id = new.id::text WHERE user_id = existing_user_id;
    UPDATE public.pack_entitlements SET user_id = new.id::text WHERE user_id = existing_user_id;
    UPDATE public.founding_grants SET user_id = new.id::text WHERE user_id = existing_user_id;
    UPDATE public.subscriptions SET user_id = new.id::text WHERE user_id = existing_user_id;
    UPDATE public.payments SET user_id = new.id::text WHERE user_id = existing_user_id;
    UPDATE public.checkout_intents SET user_id = new.id::text WHERE user_id = existing_user_id;
    UPDATE public.api_keys SET user_id = new.id::text WHERE user_id = existing_user_id;
    UPDATE public.account_security SET user_id = new.id::text WHERE user_id = existing_user_id;
    UPDATE public.auth_events SET user_id = new.id::text WHERE user_id = existing_user_id;
    UPDATE public.users SET id = new.id::text WHERE id = existing_user_id;
  END IF;

  INSERT INTO public.users (id, email, display_name, email_verified)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'displayName', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    (new.email_confirmed_at IS NOT NULL)
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        display_name = CASE WHEN public.users.display_name = '' THEN EXCLUDED.display_name ELSE public.users.display_name END,
        email_verified = public.users.email_verified OR EXCLUDED.email_verified,
        updated_at = now();

  INSERT INTO public.profiles (user_id, role, avatar_url)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'role', ''),
    COALESCE(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', '')
  )
  ON CONFLICT (user_id) DO UPDATE
    SET avatar_url = CASE WHEN public.profiles.avatar_url = '' OR public.profiles.avatar_url IS NULL THEN EXCLUDED.avatar_url ELSE public.profiles.avatar_url END,
        role = CASE WHEN public.profiles.role = '' OR public.profiles.role IS NULL THEN EXCLUDED.role ELSE public.profiles.role END,
        updated_at = now();

  RETURN new;
END;
$$;
