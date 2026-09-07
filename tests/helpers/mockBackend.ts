/**
 * Shared scaffolding for the service tests that used to mock `firebase/*`.
 *
 * Every client service now goes through `@/lib/services/backend`, so a test only
 * needs to control two things: whether a backend is configured, and what the next
 * `apiFetch`/`apiTry` call resolves to.
 *
 * The state object must come from `vi.hoisted` (it is referenced inside the mock
 * factory, which vitest hoists above the imports); the factory itself is async so
 * it can import this helper. Usage:
 *
 *   const h = vi.hoisted(() => ({ ...backendState() }));
 *   vi.mock('@/lib/services/backend', async () => {
 *     const { makeBackendModule } = await import('./helpers/mockBackend');
 *     return makeBackendModule(h);
 *   });
 */

export interface BackendCall {
  path: string;
  method: string;
  body?: unknown;
}

export interface BackendState {
  /** Mirrors `isBackendConfigured()`. */
  configured: boolean;
  /** Resolved value per path; the `'*'` key is the catch-all. */
  responses: Record<string, unknown>;
  /** When set, `apiFetch` rejects with it and `apiTry` returns its fallback. */
  error: Error | null;
  /** Every call made, in order. */
  calls: BackendCall[];
  /** Events passed to `logAnalyticsEvent`. */
  events: Array<{ name: string; params?: Record<string, unknown> }>;
}

/** A fresh state object — spread this inside `vi.hoisted`. */
export function backendState(): BackendState {
  return { configured: true, responses: {}, error: null, calls: [], events: [] };
}

/** Reset between tests, preserving the hoisted object's identity. */
export function resetBackend(h: BackendState): void {
  h.configured = true;
  h.responses = {};
  h.error = null;
  h.calls = [];
  h.events = [];
}

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

/** The stand-in module for `@/lib/services/backend`, bound to `h`. */
export function makeBackendModule(h: BackendState): Record<string, unknown> {
  const record = (path: string, opts?: { method?: string; body?: unknown }) => {
    h.calls.push({ path, method: opts?.method ?? 'GET', body: opts?.body });
  };
  const resolve = (path: string, fallback: unknown) =>
    path in h.responses ? h.responses[path] : ('*' in h.responses ? h.responses['*'] : fallback);

  return {
    ApiError,
    isBackendConfigured: () => h.configured,
    apiUrl: (path: string) => `https://api.test/api${path}`,
    apiFetch: (path: string, opts?: { method?: string; body?: unknown }) => {
      if (!h.configured) return Promise.reject(new ApiError('backend-unavailable', 0));
      record(path, opts);
      if (h.error) return Promise.reject(h.error);
      return Promise.resolve(resolve(path, {}));
    },
    apiTry: (path: string, opts: { method?: string; body?: unknown }, fallback: unknown) => {
      if (!h.configured) return Promise.resolve(fallback);
      record(path, opts);
      if (h.error) return Promise.resolve(fallback);
      return Promise.resolve(resolve(path, fallback));
    },
    logAnalyticsEvent: (name: string, params?: Record<string, unknown>) => {
      h.events.push({ name, params });
      return Promise.resolve();
    },
    setAuthTokenGetter: () => {},
  };
}
