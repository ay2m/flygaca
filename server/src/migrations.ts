import { getPool } from "./db.js";

interface Migration {
  name: string;
  sql: string;
}

/**
 * Exported so `tests/migrations.test.ts` can pin it against the canonical
 * `server/migrations/*.sql` files — this array is a serverless-friendly copy
 * (inlined so it ships in the function bundle without a filesystem read) and
 * has drifted from the files before: 0004/0005 shipped as `.sql` files that
 * this array never picked up, so every `/api/auth/register` and
 * `/api/auth/login` call 500'd on a deploy whose schema came only from this
 * endpoint (`INSERT INTO auth_events …` against a table that was never
 * created). Add new entries here in the same PR that adds the `.sql` file.
 */
export const MIGRATIONS: Migration[] = [
  {
    name: "0001_init.sql",
    sql: `
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE,
  email_verified  boolean NOT NULL DEFAULT false,
  password_hash   text,
  display_name    text NOT NULL DEFAULT '',
  google_sub      text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  digest      text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('verify', 'reset')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON auth_tokens (user_id, kind);

CREATE TABLE IF NOT EXISTS oauth_states (
  state       text PRIMARY KEY,
  return_to   text NOT NULL DEFAULT '/',
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  home_base          text NOT NULL DEFAULT '',
  licence_type       text NOT NULL DEFAULT '',
  medical_expiry     text NOT NULL DEFAULT '',
  last_flight_review text NOT NULL DEFAULT '',
  role               text NOT NULL DEFAULT '',
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flights (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id        text NOT NULL,
  date      text NOT NULL DEFAULT '',
  type      text NOT NULL DEFAULT '',
  reg       text NOT NULL DEFAULT '',
  "from"    text NOT NULL DEFAULT '',
  "to"      text NOT NULL DEFAULT '',
  total     text NOT NULL DEFAULT '',
  pic       text NOT NULL DEFAULT '',
  night     text NOT NULL DEFAULT '',
  ifr       text NOT NULL DEFAULT '',
  ldg       text NOT NULL DEFAULT '',
  night_ldg text NOT NULL DEFAULT '',
  appr      text NOT NULL DEFAULT '',
  remarks   text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS pilot_records (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id        text NOT NULL,
  category  text NOT NULL DEFAULT '',
  title     text NOT NULL DEFAULT '',
  ref       text NOT NULL DEFAULT '',
  issued    text NOT NULL DEFAULT '',
  expires   text NOT NULL DEFAULT '',
  remarks   text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS study_progress (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  summary    jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entitlements (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan       text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'school')),
  expires_at timestamptz,
  source     text CHECK (source IN ('moyasar', 'revenuecat', 'school', 'staff', 'founding')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_credits (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance    integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pack_entitlements (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_id    text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pack_id)
);

CREATE TABLE IF NOT EXISTS chat_usage (
  user_key   text NOT NULL,
  day        date NOT NULL,
  count      integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_key, day)
);

CREATE TABLE IF NOT EXISTS referral_codes (
  code       text PRIMARY KEY,
  user_id    uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  count      integer NOT NULL DEFAULT 0,
  months     jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS referral_redemptions (
  redeemer_user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code             text NOT NULL REFERENCES referral_codes(code) ON DELETE CASCADE,
  rewarded_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promo_codes (
  code            text PRIMARY KEY,
  type            text NOT NULL CHECK (type IN ('percent', 'fixed')),
  value           integer NOT NULL,
  active          boolean NOT NULL DEFAULT false,
  applies_to      text[],
  expires_at      timestamptz,
  max_redemptions integer,
  redeemed        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orgs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seat_limit    integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orgs_owner_idx ON orgs (owner_user_id);

CREATE TABLE IF NOT EXISTS org_seats (
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email      citext NOT NULL,
  status     text NOT NULL DEFAULT 'invited'
             CHECK (status IN ('invited', 'active', 'expired', 'revoked')),
  source     text NOT NULL DEFAULT 'invite',
  expires_at timestamptz,
  claimed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, email)
);
CREATE INDEX IF NOT EXISTS org_seats_email_idx ON org_seats (email);

CREATE TABLE IF NOT EXISTS schools (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  domains    citext[] NOT NULL DEFAULT '{}',
  seat_limit integer,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS school_invites (
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  email      citext NOT NULL,
  claimed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, email)
);
CREATE INDEX IF NOT EXISTS school_invites_email_idx ON school_invites (email);

CREATE TABLE IF NOT EXISTS checkout_intents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  cadence      text,
  pack_id      text,
  org_name     text,
  ref_code     text,
  promo_code   text,
  amount       integer NOT NULL,
  list_amount  integer,
  currency     text NOT NULL DEFAULT 'SAR',
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
  payment_id   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkout_intents_user_idx ON checkout_intents (user_id);
CREATE INDEX IF NOT EXISTS checkout_intents_payment_idx ON checkout_intents (payment_id);

CREATE TABLE IF NOT EXISTS payments (
  id          text PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  intent_id   uuid REFERENCES checkout_intents(id) ON DELETE SET NULL,
  amount      integer NOT NULL,
  currency    text NOT NULL DEFAULT 'SAR',
  status      text NOT NULL,
  kind        text,
  raw         jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_user_idx ON payments (user_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan            text NOT NULL,
  cadence         text NOT NULL CHECK (cadence IN ('monthly', 'annual')),
  auto_renew      boolean NOT NULL DEFAULT true,
  card_token      text,
  next_renewal_at timestamptz,
  last_renewal_at timestamptz,
  failure_count   integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_due_idx ON subscriptions (next_renewal_at)
  WHERE auto_renew AND card_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS waitlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      citext NOT NULL,
  topic      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS answer_feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  rating     text NOT NULL CHECK (rating IN ('up', 'down')),
  session    text,
  question   text,
  answer     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  digest      text NOT NULL UNIQUE,
  label       text NOT NULL DEFAULT '',
  tier        text NOT NULL DEFAULT 'free',
  revoked_at  timestamptz,
  last_used_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys (user_id);

CREATE TABLE IF NOT EXISTS founding_grants (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_usage (
  digest       text NOT NULL,
  month        text NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  PRIMARY KEY (digest, month)
);
`,
  },
  {
    name: "0002_add_apple_oauth.sql",
    sql: `
ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_sub text UNIQUE;
`,
  },
  {
    name: "0002_founder_grant_ay2m.sql",
    sql: `
WITH founder_user AS (
  INSERT INTO users (email, email_verified, display_name)
  VALUES ('ay2m@hotmail.com', true, 'Founder')
  ON CONFLICT (email) DO UPDATE
    SET email_verified = true
  RETURNING id
)
INSERT INTO entitlements (user_id, plan, source, expires_at)
SELECT id, 'school', 'founding', NULL FROM founder_user
ON CONFLICT (user_id) DO UPDATE
  SET plan = 'school', source = 'founding', expires_at = NULL, updated_at = now();

WITH founder_user AS (
  SELECT id FROM users WHERE email = 'ay2m@hotmail.com'
)
INSERT INTO pack_entitlements (user_id, pack_id)
SELECT id, pack_id FROM founder_user, (
  VALUES ('ppl-exam'), ('elp'), ('conversion'), ('cpl'), ('ir'), ('atpl'), ('medical'), ('aip')
) AS packs(pack_id)
ON CONFLICT DO NOTHING;

WITH founder_user AS (
  SELECT id FROM users WHERE email = 'ay2m@hotmail.com'
)
INSERT INTO chat_credits (user_id, balance)
SELECT id, 1000000 FROM founder_user
ON CONFLICT (user_id) DO UPDATE
  SET balance = 1000000, updated_at = now();
`,
  },
  {
    name: "0003_pdpl_and_analytics.sql",
    sql: `
ALTER TABLE org_seats ADD COLUMN IF NOT EXISTS pdpl_consent boolean DEFAULT false;
ALTER TABLE org_seats ADD COLUMN IF NOT EXISTS pdpl_consented_at timestamptz;

CREATE TABLE IF NOT EXISTS org_analytics_summary (
  org_id uuid NOT NULL PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  health_score numeric(5, 2) NOT NULL DEFAULT 0,
  pass_probability numeric(5, 2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: "0004_auth_audit_trail.sql",
    sql: `
CREATE TABLE IF NOT EXISTS auth_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid,
  event_type  text NOT NULL CHECK (event_type IN (
    'register', 'login', 'logout', 'password-reset-request', 'password-reset-confirm',
    'email-verify-request', 'email-verify-confirm', 'google-link', 'apple-link',
    'oauth-google-signin', 'oauth-apple-signin', 'passwordless-signin-request',
    'passwordless-signup-request', 'passwordless-verify'
  )),
  result      text NOT NULL CHECK (result IN ('success', 'failed', 'blocked')),
  reason      text,
  client_ip   inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS auth_events_user_idx ON auth_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_events_type_idx ON auth_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_events_client_ip_idx ON auth_events (client_ip, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_failures (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      citext,
  user_id    uuid,
  client_ip  inet NOT NULL,
  event_type text NOT NULL,
  attempt_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (email IS NOT NULL OR user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS auth_failures_email_idx ON auth_failures (email, attempt_at DESC);
CREATE INDEX IF NOT EXISTS auth_failures_user_idx ON auth_failures (user_id, attempt_at DESC);
CREATE INDEX IF NOT EXISTS auth_failures_ip_idx ON auth_failures (client_ip, attempt_at DESC);

CREATE TABLE IF NOT EXISTS account_security (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  locked_until  timestamptz,
  last_login_at timestamptz,
  suspicious    boolean NOT NULL DEFAULT false,
  breach_notified_at timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: "0005_passwordless_signin.sql",
    sql: `
CREATE TABLE IF NOT EXISTS passwordless_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  digest          text NOT NULL UNIQUE,
  email           citext NOT NULL,
  user_id         uuid,
  code            text,
  code_display    text,
  purpose         text NOT NULL CHECK (purpose IN ('signin', 'signup')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS passwordless_tokens_email_idx ON passwordless_tokens (email, created_at DESC);
CREATE INDEX IF NOT EXISTS passwordless_tokens_user_idx ON passwordless_tokens (user_id, created_at DESC) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS passwordless_tokens_expires_idx ON passwordless_tokens (expires_at) WHERE used_at IS NULL;
`,
  },
];

export async function runMigrations(): Promise<{
  ok: boolean;
  applied: string[];
  alreadyApplied: string[];
  error?: string;
}> {
  let client;
  try {
    const pool = getPool();
    client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const appliedSet = new Set(rows.map((r) => r.name));
    const newlyApplied: string[] = [];
    const alreadyApplied: string[] = [];

    for (const migration of MIGRATIONS) {
      if (appliedSet.has(migration.name)) {
        alreadyApplied.push(migration.name);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migration.name]);
        await client.query("COMMIT");
        newlyApplied.push(migration.name);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    return { ok: true, applied: newlyApplied, alreadyApplied };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, applied: [], alreadyApplied: [], error: message };
  } finally {
    client?.release();
  }
}
