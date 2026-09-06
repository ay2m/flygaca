-- Passwordless sign-in — magic links and one-time codes
--
-- Supports three flows:
-- 1. Magic link: user clicks email link → session created
-- 2. One-time code: user enters 6-digit code → session created
-- 3. Register via passwordless: email verification waits for link/code entry
--
-- Tokens use the same pattern as auth_tokens: digest is the verifiable part,
-- user_id is what's claimed, and the digest is hashed before storage.

CREATE TABLE passwordless_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  digest          text NOT NULL UNIQUE, -- Hash of the actual token
  email           citext NOT NULL,      -- Claimed email (verified at consumption)
  user_id         uuid,                 -- NULL for new signups, set for existing users
  code            text,                 -- Optional 6-digit code; NULL if link-only
  code_display    text,                 -- Formatted code for email (e.g. "123 456")
  purpose         text NOT NULL CHECK (purpose IN ('signin', 'signup')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX passwordless_tokens_email_idx ON passwordless_tokens (email, created_at DESC);
CREATE INDEX passwordless_tokens_user_idx ON passwordless_tokens (user_id, created_at DESC) WHERE used_at IS NULL;
CREATE INDEX passwordless_tokens_expires_idx ON passwordless_tokens (expires_at) WHERE used_at IS NULL;
