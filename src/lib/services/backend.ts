/**
 * Backend bootstrap — config-gated, zero-SDK.
 *
 * Replaces the old Firebase bootstrap. The app talks to one first-party REST API
 * (the Cloud Run service in `server/`) addressed by `VITE_API_BASE_URL`. When that
 * is absent — CI, the preview build, any contributor without a backend — every
 * call short-circuits and the app stays fully local-first (see `account.ts`),
 * exactly as it did when Firebase config was missing.
 *
 * Sessions are HttpOnly cookies set by the server, so there is no token to hold
 * in JS and every request simply carries `credentials: 'include'`.
 */

const env = import.meta.env;

/**
 * Base URL of the API, without a trailing slash. Empty means "same origin" only
 * when explicitly opted into via `VITE_API_SAME_ORIGIN=1`; otherwise the absence
 * of a base URL is what puts the app in local-first mode.
 */
const API_BASE_URL = String(env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

const SAME_ORIGIN = env.VITE_API_SAME_ORIGIN === '1';

/** True once an API origin is known (or same-origin mode is opted into). */
export function isBackendConfigured(): boolean {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const isTest = typeof proc !== 'undefined' && proc.env?.NODE_ENV === 'test';
  if (isTest) {
    return false;
  }
  if (env?.VITEST) {
    return false;
  }
  if (API_BASE_URL || SAME_ORIGIN) {
    return true;
  }
  if (typeof window !== 'undefined' && window.location?.hostname?.includes('flygaca.com')) {
    return true;
  }
  return false;
}

/** Absolute URL for an API path (`/auth/session` → `https://api.../api/auth/session`). */
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}/api${p}`;
}

/**
 * An error carrying the server's stable machine code. Auth routes deliberately
 * emit the same `auth/*` codes the Firebase SDK used, so `calc/app/authError.ts`
 * and its i18n keys map them without change.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message?: string) {
    super(message ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;

export function setAuthTokenGetter(getter: TokenGetter | null): void {
  tokenGetter = getter;
}

/**
 * Call the API and parse its JSON envelope. Throws {@link ApiError} on any
 * non-2xx, using the server's `error` code when present. Callers that must not
 * fail loudly should use {@link apiTry}.
 */
export async function apiFetch<T>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
  if (!isBackendConfigured()) throw new ApiError('backend-unavailable', 0);

  const headers: Record<string, string> = {};
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (tokenGetter) {
    try {
      const token = await tokenGetter();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch {
      // Best-effort token attachment
    }
  }

  const res = await fetch(apiUrl(path), {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const rec = (data ?? {}) as { error?: unknown; message?: unknown };
    const code = typeof rec.error === 'string' ? rec.error : `http-${res.status}`;
    const message = typeof rec.message === 'string' ? rec.message : undefined;
    throw new ApiError(code, res.status, message);
  }

  return data as T;
}

/**
 * Best-effort variant: resolves to `fallback` instead of throwing. Used by the
 * grant/claim and dashboard-read paths, which must degrade to an empty state
 * when the backend is unreachable or the caller isn't permitted.
 */
export async function apiTry<T>(path: string, opts: ApiFetchOptions, fallback: T): Promise<T> {
  if (!isBackendConfigured()) return fallback;
  try {
    return await apiFetch<T>(path, opts);
  } catch {
    return fallback;
  }
}

/**
 * Best-effort GA4 custom event via gtag, kept as a drop-in for the old Firebase
 * Analytics helper. No-ops (never throws) when gtag isn't on the page — GA is
 * loaded by `AnalyticsProvider` only when `VITE_GA_MEASUREMENT_ID` is set.
 */
export async function logAnalyticsEvent(
  name: string,
  params?: Record<string, unknown>,
): Promise<void> {
  try {
    const gtag = (globalThis as { gtag?: (...args: unknown[]) => void }).gtag;
    if (typeof gtag !== 'function') return;
    gtag('event', name, params ?? {});
  } catch {
    /* analytics is non-essential — never let it surface an error */
  }
}
