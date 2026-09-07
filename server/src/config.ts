/**
 * Environment configuration — the single place the server reads `process.env`.
 *
 * This replaces the `defineString`/`defineInt`/`defineBoolean` params the Cloud
 * Functions build used. On Cloud Run everything arrives as a plain env var, with
 * secrets mounted from Secret Manager (see docs/RUNBOOK-deploy.md).
 *
 * `requireEnv` throws at boot rather than at first request, so a misconfigured
 * revision fails its health check instead of silently 500-ing later.
 */

function str(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

/** Read a required var, throwing a named error at boot when it is absent. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export const config = {
  /** Cloud Run supplies PORT; 8080 is its default contract. */
  port: int("PORT", 8080),
  nodeEnv: str("NODE_ENV", "development"),
  isProduction: str("NODE_ENV", "development") === "production",

  /** Public origin of the SPA — used for OAuth redirects and cookie domain. */
  appOrigin: str("APP_ORIGIN", "http://localhost:5173"),
  /** Public origin of this API — used to build the OAuth callback URL. */
  apiOrigin: str("API_ORIGIN", "http://localhost:8080"),

  db: {
    /** Full connection string. On Cloud Run use the Cloud SQL unix socket host. */
    url: str("DATABASE_URL", str("POSTGRES_URL")),
    /** Max pool size — keep low, Cloud Run scales horizontally. */
    poolMax: int("DATABASE_POOL_MAX", 5),
  },

  session: {
    /** HS256 signing secret for session JWTs. Rotate via Secret Manager. */
    secret: str("SESSION_SECRET"),
    /** Session lifetime in days. */
    ttlDays: int("SESSION_TTL_DAYS", 30),
    cookieName: str("SESSION_COOKIE_NAME", "fg_session"),
    /** Set when the API and SPA share a registrable domain (e.g. `.flygaca.com`). */
    cookieDomain: str("SESSION_COOKIE_DOMAIN"),
  },

  google: {
    clientId: str("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: str("GOOGLE_OAUTH_CLIENT_SECRET"),
  },

  apple: {
    clientId: str("APPLE_OAUTH_CLIENT_ID"),
    clientSecret: str("APPLE_OAUTH_CLIENT_SECRET"),
  },

  supabase: {
    url: str("SUPABASE_URL"),
    publishableKey: str("SUPABASE_PUBLISHABLE_KEY"),
    secretKey: str("SUPABASE_SECRET_KEY"),
    jwksUrl: str(
      "SUPABASE_JWKS_URL",
      str("SUPABASE_URL") ? `${str("SUPABASE_URL")}/auth/v1/.well-known/jwks.json` : "",
    ),
    jwtSecret: str("SUPABASE_JWT_SECRET", str("SUPABASE_SECRET_KEY")),
  },

  /**
   * The Captain Adel model endpoint. OpenAI chat-completions shape, so it can be
   * pointed at any compatible provider without a code change — Google Gemini by
   * default (its OpenAI-compatible endpoint), or HUMAIN's ALLaM / a self-hosted
   * ALLaM behind vLLM for a fully in-Kingdom generation hop.
   *
   * Deliberately has no default base URL. A wrong-but-plausible default would
   * send regulatory questions to whatever answered, and the whole reason this
   * replaced Gemini is that the destination must be a decision, not an accident.
   * The model ids must match the provider's own catalog.
   */
  model: {
    baseUrl: str(
      "MODEL_BASE_URL",
      str("GOOGLE_GENAI_API_KEY") ? "https://generativelanguage.googleapis.com/v1beta/openai/" : "",
    ),
    apiKey: str("MODEL_API_KEY", str("GOOGLE_GENAI_API_KEY")),
    // Defaults track the configured provider (Google Gemini via its
    // OpenAI-compatible endpoint). They are only a fallback — production sets
    // MODEL_ID_* explicitly — but keeping them aligned with MODEL_BASE_URL means
    // a deploy that sets the endpoint and key, but forgets the ids, still works
    // instead of 404ing on a stale model name. Verify against
    // ai.google.dev/gemini-api/docs/models; Google rotates version strings.
    tiers: {
      fast: str("MODEL_ID_FAST", "gemini-2.5-flash"),
      pro: str("MODEL_ID_PRO", "gemini-2.5-pro"),
    },
  },

  mail: {
    /** Transactional email API key. When absent, mails are logged, not sent. */
    apiKey: str("MAIL_API_KEY"),
    from: str("MAIL_FROM", "Fly GACA <no-reply@flygaca.com>"),
    /** Base URL of the provider's send endpoint (Resend-compatible). */
    endpoint: str("MAIL_ENDPOINT", "https://api.resend.com/emails"),
  },

  moyasar: {
    secretKey: str("MOYASAR_SECRET_KEY"),
    webhookSecret: str("MOYASAR_WEBHOOK_SECRET"),
  },

  /** Shared secret the Cloud Scheduler renewal job presents. */
  cronSecret: str("CRON_SECRET"),

  chat: {
    /** Free questions per day for a signed-in free-tier user. */
    freeDailyLimit: int("CHAT_FREE_DAILY_LIMIT", 5),
    /** Questions per purchased credit pack. Mirrors src/lib/services/billing.ts. */
    creditPackSize: int("CHAT_CREDIT_PACK_SIZE", 50),
    /** Kill switch for the chat gateway. */
    enabled: bool("CHAT_ENABLED", true),
  },

  /** Extra CORS origins beyond the built-in allowlist, comma-separated. */
  extraAllowedOrigins: str("EXTRA_ALLOWED_ORIGINS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
} as const;

/**
 * Fail fast on anything the service cannot run without. Called from `index.ts`
 * before the listener binds, so a bad revision never passes its health check.
 */
export function assertRequiredConfig(): void {
  requireEnv("DATABASE_URL");
  requireEnv("SESSION_SECRET");
  if (config.session.secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
}
