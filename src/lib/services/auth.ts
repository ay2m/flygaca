/**
 * Auth surface. Backed by the first-party API (`server/`) when configured; a
 * no-op when not — every method degrades gracefully so the local-first account
 * store (`account.ts`) keeps working without a backend.
 *
 * The session is an HttpOnly cookie set by the server, so nothing sensitive is
 * held in JS. There is no real-time listener as there was with the Firebase SDK:
 * `onAuthChange` fetches the session once, then re-notifies subscribers whenever
 * this module mutates auth state or the tab regains focus.
 *
 * Server errors arrive as the same `auth/*` codes the Firebase SDK emitted, so
 * `calc/app/authError.ts` and its i18n keys map them unchanged.
 */
import { isNative } from '@/lib/native/nativeBridge';
import { isBackendConfigured, apiFetch, apiUrl, ApiError } from '@/lib/services/backend';
import {
  isSupabaseConfigured,
  getSupabase,
  signInWithOAuth as supabaseSignInWithOAuth,
  signInWithPassword as supabaseSignInWithPassword,
  signUpWithPassword as supabaseSignUpWithPassword,
  signInWithMagicLink as supabaseSignInWithMagicLink,
  sendPasswordResetEmail as supabaseSendPasswordResetEmail,
  updatePassword as supabaseUpdatePassword,
  signOutSupabase,
  type AuthOAuthProvider,
} from '@/lib/supabase/client';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  avatarUrl?: string | null;
  provider?: string | null;
}

interface SessionResponse {
  user: AuthUser | null;
}

/** Where sign-in is handled for the current runtime. */
export function authChannel(): 'native' | 'web' {
  return isNative() ? 'native' : 'web';
}

/** True when a real auth backend is available (API base URL present). */
export function isAuthAvailable(): boolean {
  return isBackendConfigured();
}

/** True when Supabase client is available. */
export function isSupabaseAuthAvailable(): boolean {
  return isSupabaseConfigured();
}

type Listener = (user: AuthUser | null) => void;

const listeners = new Set<Listener>();
let current: AuthUser | null = null;
let sessionPromise: Promise<AuthUser | null> | null = null;

function emit(user: AuthUser | null): void {
  current = user;
  for (const cb of listeners) cb(user);
}

function mapSupabaseUser(
  user: {
    id: string;
    email?: string | null;
    email_confirmed_at?: string | null;
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
  } | null,
): AuthUser | null {
  if (!user) return null;
  const meta = user.user_metadata || {};
  return {
    uid: user.id,
    email: user.email ?? null,
    displayName:
      (meta.displayName as string) || (meta.full_name as string) || (meta.name as string) || null,
    emailVerified: Boolean(user.email_confirmed_at),
    avatarUrl: (meta.avatar_url as string) || (meta.picture as string) || null,
    provider: (user.app_metadata?.provider as string) || null,
  };
}

function mapSupabaseError(err: unknown): Error {
  if (!err) return new ApiError('auth/invalid-credential', 400);
  const msg = ((err as { message?: string })?.message || '').toLowerCase();
  const status = (err as { status?: number })?.status;
  if (status === 429 || msg.includes('rate limit')) {
    return new ApiError('auth/too-many-requests', 429);
  }
  if (
    msg.includes('invalid login credentials') ||
    msg.includes('invalid credential') ||
    msg.includes('invalid_grant')
  ) {
    return new ApiError('auth/invalid-credential', 401);
  }
  if (
    msg.includes('already registered') ||
    msg.includes('already in use') ||
    msg.includes('user already exists')
  ) {
    return new ApiError('auth/email-already-in-use', 409);
  }
  if (
    msg.includes('weak') ||
    msg.includes('at least 6 characters') ||
    msg.includes('password should be')
  ) {
    return new ApiError('auth/weak-password', 400);
  }
  if (msg.includes('user not found') || msg.includes('no user found')) {
    return new ApiError('auth/user-not-found', 404);
  }
  return new ApiError((err as { code?: string })?.code || 'auth/invalid-credential', status || 400);
}

/** Fetch (and memoize) the current session. Resolves `null` when signed out. */
async function fetchSession(force = false): Promise<AuthUser | null> {
  if (!isBackendConfigured() && !isSupabaseConfigured()) return null;
  if (force) sessionPromise = null;

  sessionPromise ??= (async () => {
    // Check backend session first if configured (mirrors test harness and first-party API)
    if (isBackendConfigured()) {
      const backendUser = await apiFetch<SessionResponse>('/auth/session')
        .then((r) => r.user ?? null)
        .catch(() => null);
      if (backendUser) return backendUser;
    }

    // Check Supabase session if configured
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabase();
        if (client) {
          const { data } = await client.auth.getSession();
          if (data?.session?.user) {
            return mapSupabaseUser(data.session.user);
          }
        }
      } catch (err) {
        console.warn('Supabase fetchSession error:', err);
      }
    }

    return null;
  })();

  const user = await sessionPromise;
  current = user;
  return user;
}

/**
 * The signed-in user right now, or `null`. Reads the memoized session, so callers
 * that only need a one-shot "is anyone signed in?" answer (the billing guards)
 * don't have to open a subscription to find out.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  return fetchSession();
}

interface AuthConfig {
  google: { configured: boolean };
  apple: { configured: boolean };
}

let authConfigCache: AuthConfig | null = null;

/**
 * Fetch which OAuth providers are configured on the backend.
 * Returns {google: {configured: true/false}, apple: {configured: true/false}}
 */
export async function getOAuthConfig(): Promise<AuthConfig> {
  if (authConfigCache) return authConfigCache;
  if (!isBackendConfigured()) {
    return { google: { configured: false }, apple: { configured: false } };
  }

  try {
    authConfigCache = await apiFetch<AuthConfig>('/auth/config');
    return authConfigCache;
  } catch {
    return { google: { configured: false }, apple: { configured: false } };
  }
}

/**
 * The bearer token for the current session, used by the native shell where a
 * cross-origin cookie is unreliable. Returns `null` on web — there the cookie
 * travels with `credentials: 'include'` and no token is needed.
 */
export async function getIdToken(): Promise<string | null> {
  if (isSupabaseConfigured()) {
    try {
      const client = getSupabase();
      if (client) {
        const { data } = await client.auth.getSession();
        if (data?.session?.access_token) return data.session.access_token;
      }
    } catch {
      // Fall through to backend
    }
  }

  if (!isBackendConfigured() || !isNative()) return null;
  const r = await apiFetch<{ token: string | null }>('/auth/token').catch(() => null);
  return r?.token ?? null;
}

/**
 * Subscribe to auth changes. Calls back with the current user as soon as the
 * session resolves (immediately with `null` when unconfigured), then on every
 * subsequent sign-in/sign-out and on tab refocus.
 */
export async function onAuthChange(cb: Listener): Promise<() => void> {
  if (!isAuthAvailable()) {
    cb(null);
    return () => {};
  }

  listeners.add(cb);
  const revalidate = () => {
    void fetchSession(true).then((u) => {
      if (u?.uid !== current?.uid || u?.emailVerified !== current?.emailVerified) emit(u);
    });
  };

  let supabaseUnsub: (() => void) | undefined;
  if (isSupabaseConfigured()) {
    const client = getSupabase();
    if (client) {
      const { data: sub } = client.auth.onAuthStateChange(async (_event, session) => {
        const mapped = session?.user ? mapSupabaseUser(session.user) : null;
        emit(mapped);
      });
      supabaseUnsub = () => sub.subscription.unsubscribe();
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('focus', revalidate);
  }

  cb(await fetchSession());

  return () => {
    listeners.delete(cb);
    if (supabaseUnsub) supabaseUnsub();
    if (typeof window !== 'undefined') window.removeEventListener('focus', revalidate);
  };
}

function requireBackend(): void {
  if (!isAuthAvailable()) throw new ApiError('auth-unavailable', 0);
}

export async function signInWithGoogle(): Promise<AuthUser | null> {
  requireBackend();
  const returnTo = typeof window !== 'undefined' ? window.location.href : '/';
  window.location.assign(
    `${apiUrl('/auth/google/start')}?returnTo=${encodeURIComponent(returnTo)}`,
  );
  return null;
}

export async function signInWithApple(): Promise<AuthUser | null> {
  requireBackend();
  const returnTo = typeof window !== 'undefined' ? window.location.href : '/';
  window.location.assign(`${apiUrl('/auth/apple/start')}?returnTo=${encodeURIComponent(returnTo)}`);
  return null;
}

/**
 * Generic OAuth sign-in for all supported providers:
 * Google, Apple, GitHub, Discord.
 */
export async function signInWithOAuthProvider(
  provider: AuthOAuthProvider,
  redirectTo?: string,
): Promise<void> {
  if (isSupabaseConfigured()) {
    await supabaseSignInWithOAuth({ provider, redirectTo });
    return;
  }
  if (provider === 'google') {
    await signInWithGoogle();
    return;
  }
  if (provider === 'apple') {
    await signInWithApple();
    return;
  }
  requireBackend();
  throw new ApiError('auth/operation-not-allowed', 400);
}

/** Sign in with a passwordless Magic Link (OTP). */
export async function signInWithMagicLink(email: string): Promise<void> {
  requireBackend();
  if (isSupabaseConfigured()) {
    try {
      await supabaseSignInWithMagicLink(email);
      return;
    } catch (err) {
      throw mapSupabaseError(err);
    }
  }
  // If only backend is configured, send passwordless email request
  await apiFetch<unknown>('/auth/passwordless/request', {
    method: 'POST',
    body: { email },
  });
}

export async function signInWithEmail(email: string, password: string): Promise<AuthUser> {
  requireBackend();

  if (isSupabaseConfigured()) {
    try {
      const data = await supabaseSignInWithPassword(email, password);
      const user = mapSupabaseUser(data.user);
      if (!user) throw new ApiError('auth/invalid-credential', 401);
      sessionPromise = Promise.resolve(user);
      emit(user);
      return user;
    } catch (err) {
      // If Supabase authentication fails and backend is configured, attempt backend fallback
      if (!isBackendConfigured()) {
        throw mapSupabaseError(err);
      }
    }
  }

  const { user } = await apiFetch<SessionResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (!user) throw new ApiError('auth/invalid-credential', 401);
  sessionPromise = Promise.resolve(user);
  emit(user);
  return user;
}

export async function registerWithEmail(
  email: string,
  password: string,
  displayName?: string,
  role?: string,
): Promise<AuthUser> {
  requireBackend();

  if (isSupabaseConfigured()) {
    try {
      const data = await supabaseSignUpWithPassword(email, password, { displayName, role });
      const user = mapSupabaseUser(data.user);
      if (!user) throw new ApiError('auth/internal-error', 500);
      sessionPromise = Promise.resolve(user);
      emit(user);
      return user;
    } catch (err) {
      if (!isBackendConfigured()) {
        throw mapSupabaseError(err);
      }
    }
  }

  const { user } = await apiFetch<SessionResponse>('/auth/register', {
    method: 'POST',
    body: { email, password, displayName },
  });
  if (!user) throw new ApiError('auth/internal-error', 500);
  sessionPromise = Promise.resolve(user);
  emit(user);
  return user;
}

export async function signOutUser(): Promise<void> {
  if (isSupabaseConfigured()) {
    await signOutSupabase().catch(() => null);
  }
  if (isBackendConfigured()) {
    await apiFetch<unknown>('/auth/logout', { method: 'POST' }).catch(() => null);
  }
  sessionPromise = Promise.resolve(null);
  emit(null);
}

/** Email the user a password-reset link. */
export async function sendPasswordReset(email: string): Promise<void> {
  requireBackend();
  if (isBackendConfigured()) {
    await apiFetch<unknown>('/auth/password-reset', { method: 'POST', body: { email } });
    return;
  }
  if (isSupabaseConfigured()) {
    try {
      await supabaseSendPasswordResetEmail(email);
      return;
    } catch (err) {
      throw mapSupabaseError(err);
    }
  }
}

/** Update the current user's password. */
export async function updateUserPassword(newPassword: string): Promise<void> {
  requireBackend();
  if (isSupabaseConfigured()) {
    try {
      await supabaseUpdatePassword(newPassword);
      return;
    } catch (err) {
      if (!isBackendConfigured()) throw mapSupabaseError(err);
    }
  }
  await apiFetch<unknown>('/auth/password-change', {
    method: 'POST',
    body: { password: newPassword },
  });
}

/** Re-send the verification email to the current user (no-op when signed out). */
export async function resendEmailVerification(): Promise<void> {
  requireBackend();
  if (isBackendConfigured()) {
    if (!(await fetchSession())) return;
    await apiFetch<unknown>('/auth/verify-email/resend', { method: 'POST' });
    return;
  }

  const cur = await fetchSession();
  if (!cur?.email) return;

  if (isSupabaseConfigured()) {
    try {
      await supabaseSendPasswordResetEmail(cur.email);
    } catch {
      /* ignore */
    }
  }
}
