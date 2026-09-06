-- 0006_supabase_auth_sync.sql
-- Synchronizes Supabase Auth users to public.users & public.profiles,
-- adds avatar_url to profiles, and establishes Supabase RLS policies.

-- 1. Add avatar_url column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text DEFAULT '';

-- 2. Trigger function to sync new Supabase auth.users to public.users and public.profiles
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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

-- Drop and recreate the trigger on auth.users (if auth schema exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT OR UPDATE OF email, email_confirmed_at, raw_user_meta_data
      ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
  END IF;
END
$$;

-- 3. Row Level Security Policies for Authenticated Supabase Clients

-- Users table policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'users_read_own') THEN
    CREATE POLICY users_read_own ON public.users FOR SELECT TO authenticated USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'users_update_own') THEN
    CREATE POLICY users_update_own ON public.users FOR UPDATE TO authenticated USING (auth.uid() = id);
  END IF;
END
$$;

-- Profiles table policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_read_own') THEN
    CREATE POLICY profiles_read_own ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_write_own') THEN
    CREATE POLICY profiles_write_own ON public.profiles FOR ALL TO authenticated USING (auth.uid() = user_id);
  END IF;
END
$$;

-- Flights table policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'flights' AND policyname = 'flights_access_own') THEN
    CREATE POLICY flights_access_own ON public.flights FOR ALL TO authenticated USING (auth.uid() = user_id);
  END IF;
END
$$;

-- Pilot records table policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pilot_records' AND policyname = 'pilot_records_access_own') THEN
    CREATE POLICY pilot_records_access_own ON public.pilot_records FOR ALL TO authenticated USING (auth.uid() = user_id);
  END IF;
END
$$;

-- Study progress table policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'study_progress' AND policyname = 'study_progress_access_own') THEN
    CREATE POLICY study_progress_access_own ON public.study_progress FOR ALL TO authenticated USING (auth.uid() = user_id);
  END IF;
END
$$;

-- Entitlements read policy
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'entitlements' AND policyname = 'entitlements_read_own') THEN
    CREATE POLICY entitlements_read_own ON public.entitlements FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
END
$$;

-- Chat credits read policy
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'chat_credits' AND policyname = 'chat_credits_read_own') THEN
    CREATE POLICY chat_credits_read_own ON public.chat_credits FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
END
$$;
