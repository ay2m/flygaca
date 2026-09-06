-- Auth audit trail — compliance and security monitoring
--
-- Records all authentication events (login, register, password reset, etc.)
-- for PDPL compliance, security investigation, and anomaly detection.
-- Does not store sensitive data — only event type, user_id, timestamp, result.

CREATE TABLE auth_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid,
  event_type  text NOT NULL CHECK (event_type IN (
    'register', 'login', 'logout', 'password-reset-request', 'password-reset-confirm',
    'email-verify-request', 'email-verify-confirm', 'google-link', 'apple-link',
    'oauth-google-signin', 'oauth-apple-signin', 'passwordless-signin-request',
    'passwordless-signup-request', 'passwordless-verify'
  )),
  result      text NOT NULL CHECK (result IN ('success', 'failed', 'blocked')),
  -- Optional reason for failure/block (e.g., 'rate-limited', 'invalid-password', 'email-not-verified')
  reason      text,
  -- Client IP for non-authenticated events (registration attempt, login failure)
  client_ip   inet,
  -- User-Agent for additional context
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX auth_events_user_idx ON auth_events (user_id, created_at DESC);
CREATE INDEX auth_events_type_idx ON auth_events (event_type, created_at DESC);
CREATE INDEX auth_events_client_ip_idx ON auth_events (client_ip, created_at DESC);

-- Failed authentication attempts tracking for brute-force detection
-- Email (for registration/reset) or user_id (for login) is tracked
CREATE TABLE auth_failures (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      citext,
  user_id    uuid,
  client_ip  inet NOT NULL,
  event_type text NOT NULL,
  attempt_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (email IS NOT NULL OR user_id IS NOT NULL)
);

CREATE INDEX auth_failures_email_idx ON auth_failures (email, attempt_at DESC);
CREATE INDEX auth_failures_user_idx ON auth_failures (user_id, attempt_at DESC);
CREATE INDEX auth_failures_ip_idx ON auth_failures (client_ip, attempt_at DESC);

-- Account security flags for temporary blocks
CREATE TABLE account_security (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Locked due to too many failed password attempts
  locked_until  timestamptz,
  -- Last successful login time
  last_login_at timestamptz,
  -- Flagged for suspicious activity
  suspicious    boolean NOT NULL DEFAULT false,
  -- PDPL breach notification sent
  breach_notified_at timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
