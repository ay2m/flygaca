/**
 * Fly GACA — Supabase Client & Auth SDK
 *
 * Supabase client singleton configured with best practices:
 * - Auto-refreshing JWTs
 * - Persistent sessions in localStorage
 * - URL session detection for OAuth callbacks and Magic Link redirects
 * - Typed helpers for Google, Apple, GitHub, Discord OAuth, Email/Password,
 *   Magic Link OTP, password recovery, and user profile management.
 */
import { createClient, type SupabaseClient, type Provider } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Validates if Supabase environment variables are present and well-formed. */
export function isSupabaseConfigured(): boolean {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  try {
    const url = new URL(SUPABASE_URL);
    return Boolean(url.host && SUPABASE_ANON_KEY.length > 10);
  } catch {
    return false;
  }
}

let supabaseInstance: SupabaseClient | null = null;

/**
 * Returns the singleton Supabase client instance, initializing it if necessary.
 * Returns null if Supabase is not configured.
 */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!supabaseInstance && SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        storageKey: 'flygaca:supabase:auth',
        flowType: 'pkce',
      },
    });
  }
  return supabaseInstance;
}

/** Pre-instantiated client export (null-safe through helpers below). */
export const supabase = getSupabase();

/** Computes the safe origin-based redirect URL for OAuth and Magic Links. */
export function getAuthRedirectUrl(destination = '/account'): string {
  if (typeof window === 'undefined') return destination;
  const base = window.location.origin;
  const path = destination.startsWith('/') ? destination : `/${destination}`;
  return `${base}${path}`;
}

/** Supported OAuth providers in Fly GACA. */
export type AuthOAuthProvider = 'google' | 'apple' | 'github' | 'discord';

export interface SignInOAuthOptions {
  provider: AuthOAuthProvider;
  redirectTo?: string;
  scopes?: string;
}

/**
 * Sign in or sign up via an OAuth provider (Google, Apple, GitHub, Discord).
 * Uses PKCE authorization code flow.
 */
export async function signInWithOAuth({
  provider,
  redirectTo,
  scopes,
}: SignInOAuthOptions) {
  const client = getSupabase();
  if (!client) throw new Error('supabase-not-configured');

  const redirectUrl = redirectTo || getAuthRedirectUrl('/account');
  const { data, error } = await client.auth.signInWithOAuth({
    provider: provider as Provider,
    options: {
      redirectTo: redirectUrl,
      scopes,
      queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
    },
  });

  if (error) throw error;
  return data;
}

/** Sign in with traditional Email & Password. */
export async function signInWithPassword(email: string, password: string) {
  const client = getSupabase();
  if (!client) throw new Error('supabase-not-configured');

  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) throw error;
  return data;
}

/** Sign up with Email, Password, and user metadata (displayName, callsign, role). */
export async function signUpWithPassword(
  email: string,
  password: string,
  metadata?: { displayName?: string; role?: string; avatarUrl?: string },
) {
  const client = getSupabase();
  if (!client) throw new Error('supabase-not-configured');

  const { data, error } = await client.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: {
        displayName: metadata?.displayName,
        full_name: metadata?.displayName,
        role: metadata?.role,
        avatar_url: metadata?.avatarUrl,
      },
      emailRedirectTo: getAuthRedirectUrl('/account?auth=verified'),
    },
  });

  if (error) throw error;
  return data;
}

/** Sign in with a passwordless Magic Link sent via email. */
export async function signInWithMagicLink(email: string, redirectTo?: string) {
  const client = getSupabase();
  if (!client) throw new Error('supabase-not-configured');

  const redirectUrl = redirectTo || getAuthRedirectUrl('/account?auth=magic-link');
  const { data, error } = await client.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      emailRedirectTo: redirectUrl,
    },
  });

  if (error) throw error;
  return data;
}

/** Send a password reset email. */
export async function sendPasswordResetEmail(email: string, redirectTo?: string) {
  const client = getSupabase();
  if (!client) throw new Error('supabase-not-configured');

  const redirectUrl = redirectTo || getAuthRedirectUrl('/account?auth=reset-password');
  const { data, error } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: redirectUrl,
  });

  if (error) throw error;
  return data;
}

/** Update the current user's password. */
export async function updatePassword(newPassword: string) {
  const client = getSupabase();
  if (!client) throw new Error('supabase-not-configured');

  const { data, error } = await client.auth.updateUser({
    password: newPassword,
  });

  if (error) throw error;
  return data;
}

/** Update user metadata in Supabase Auth. */
export async function updateUserData(data: { displayName?: string; avatarUrl?: string; role?: string }) {
  const client = getSupabase();
  if (!client) throw new Error('supabase-not-configured');

  const { data: res, error } = await client.auth.updateUser({
    data: {
      displayName: data.displayName,
      full_name: data.displayName,
      avatar_url: data.avatarUrl,
      role: data.role,
    },
  });

  if (error) throw error;
  return res;
}

/** Sign out of the current Supabase session. */
export async function signOutSupabase() {
  const client = getSupabase();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) console.warn('Supabase sign-out warning:', error);
}

/** Get current active session if any. */
export async function getSupabaseSession() {
  const client = getSupabase();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session;
}

/** Get current user from Supabase. */
export async function getSupabaseUser() {
  const client = getSupabase();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user;
}

/**
 * Upload an avatar image file to Supabase Storage 'avatars' bucket.
 * Returns public URL of uploaded image or null on error.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string | null> {
  const client = getSupabase();
  if (!client) return null;

  try {
    const ext = file.name.split('.').pop() || 'png';
    const filePath = `${userId}/avatar-${Date.now()}.${ext}`;

    const { error: uploadError } = await client.storage
      .from('avatars')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      console.warn('Avatar upload error:', uploadError);
      return null;
    }

    const { data } = client.storage.from('avatars').getPublicUrl(filePath);
    return data.publicUrl;
  } catch (err) {
    console.warn('Avatar upload exception:', err);
    return null;
  }
}
