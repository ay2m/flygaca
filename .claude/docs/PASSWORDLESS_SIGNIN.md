# Passwordless Sign-In Implementation

Passwordless authentication for FlyGACA — magic links and one-time codes, no passwords required.

## Overview

Three sign-in flows, all leading to a session without a password:

1. **Magic link** — User clicks email link → auto-signin → session created
2. **One-time code** — User copies 6-digit code → enters manually → session created  
3. **Signup via passwordless** — Same flow but creates account first, email auto-verified

All tokens are single-use, time-limited (10 minutes), and tracked in the audit trail for PDPL compliance.

## Architecture

### Database Schema (Migration 0005)

```sql
CREATE TABLE passwordless_tokens (
  digest           text NOT NULL UNIQUE,    -- Hash of the actual token
  email            citext NOT NULL,          -- Claimed email
  user_id          uuid,                     -- NULL for signups
  code             text,                     -- 6-digit code
  code_display     text,                     -- "123 456" format for email
  purpose          text,                     -- "signin" or "signup"
  expires_at       timestamptz,              -- 10 minutes
  used_at          timestamptz               -- Single-use marker
);
```

**Key design:**
- `digest` is the hashed token (magic link); `code` is the numeric code
- Both come from the same random source (32 + 3 bytes)
- Single-use enforced by `used_at IS NULL` check in UPDATE (atomic)
- Email is stored (not user_id) so codes work before account creation

### API Routes

```
POST /api/auth/passwordless/request
  Request a passwordless token. Sends magic link + code via email.
  
  Request: { email: "user@example.com" }
  Response: { ok: true, message: "Check your email..." }
  
  Always 200 — no account enumeration.
  Rate-limited to 5 requests per email per 24 hours.

POST /api/auth/passwordless/verify
  Verify a one-time code. Creates session and returns user.
  
  Request: { code: "123456" }
  Response: { user: { uid, email, displayName, emailVerified } }
  
  201 on success, 400 if code is invalid/expired.

GET /api/auth/passwordless/verify?token=...
  Verify magic link (clicked from email). Redirects to app.
  
  Redirects to: /account?signin=success (or ?signin=invalid on failure)
```

### Audit Trail

All passwordless events are logged for PDPL compliance:

- `passwordless-signin-request` — User requests signin token (existing account)
- `passwordless-signup-request` — User requests signup token (new account)
- `passwordless-verify` — Token/code consumed, session created

Events include:
- `result`: "success" / "failed" / "blocked"
- `reason`: "invalid-email", "token-already-sent", "invalid-action-code"
- `clientIp`: Source of the request
- `userAgent`: Browser/app context

## Implementation Details

### Token Generation

```typescript
// passwordless-core.ts
generatePasswordlessToken() → {
  token: "a1b2c3d4..." (32 bytes hex, for magic link)
  code: "123456"         (6 digits, 3 bytes)
  codeDisplay: "123 456" (formatted for email)
}
```

**Why two tokens from one source:**
- Single generation call = consistent token pair
- Code is short, user-readable; token is long, URL-safe
- Both are cryptographically strong (24-bits for code = ~16.7M options)

### Email Templates

Magic link email includes both:
- Clickable "Sign in" button (uses token)
- "One-time code: 123 456" (fallback for copy-paste)

User can use either; code can be entered on sign-in form.

### Single-Use Enforcement

```sql
-- Atomically mark token as used and return user_id
UPDATE passwordless_tokens
  SET used_at = now()
  WHERE digest = $1 AND used_at IS NULL AND expires_at > now()
  RETURNING user_id, email;
```

The `used_at IS NULL` check inside the UPDATE ensures concurrency safety:
- First request wins, gets user_id
- Second request gets no rows (already used)
- No retry/race-condition vulnerability

### Signup Flow

When code is consumed and `user_id IS NULL`:
1. Create account with email verified = true
2. Log `register` event with reason = "passwordless-signup"
3. Create session immediately
4. Return user object

Email verification is implicit — user proved control by entering the code.

## Configuration

### Timeouts

- `PASSWORD_LESS_TTL_MINUTES = 10` — Token expiry (passwordless-core.ts)
- `PASSWORD_LESS_MAX_PER_EMAIL_PER_DAY = 5` — Request spam limit

### Rate Limiting

Passwordless requests use the same limiter as password login:
- `express-rate-limit`: 20 requests per 15 minutes per IP
- Also checks `getPendingPasswordlessToken()` to prevent immediate re-requests

### Email

Uses the existing mail infrastructure (Resend-compatible):
- `sendPasswordlessSigninEmail(email, token, code)` in mail.ts
- HTML layout with styled button + fallback text link
- Logged, never sent, if `MAIL_API_KEY` is unset (local dev)

## Client Integration

### Sign-In Flow

```typescript
// 1. User enters email
POST /api/auth/passwordless/request
// → "Check your email for a code"

// 2a. User clicks magic link from email
GET /api/auth/passwordless/verify?token=...
// → Redirect: /account?signin=success (session established)

// 2b. User enters code manually on sign-in form
POST /api/auth/passwordless/verify
{ code: "123456" }
// → { user: {...} } + session cookie established
```

### UI Recommendations

**Sign-In Form**
- Email field
- Passwordless button: "Send me a sign-in code" (primary)
- Password alternative: "Sign in with password" (secondary)

**Signup Form**
- Email field
- Passwordless button: "Create account with sign-in code" (primary)
- Password alternative: "Sign up with password" (secondary)

**After Request**
- Show: "We sent a code to user@example.com"
- Two-step entry:
  1. Paste magic link (redirects immediately)
  2. Or enter 6-digit code in the same form

## Testing

### Manual Test: Magic Link Flow

```bash
# 1. Request token
curl -X POST http://localhost:8080/api/auth/passwordless/request \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com"}'

# Check server log for:
# [mail] would send "Sign in to Fly GACA" to test@example.com
# Copy the token URL from the message

# 2. Verify via magic link
curl http://localhost:8080/api/auth/passwordless/verify?token=<TOKEN>
# Redirects to: http://localhost:5173/account?signin=success

# 3. Check session was created
curl http://localhost:8080/api/auth/session -b 'fg_session=<COOKIE>'
# Returns: { user: { uid, email, displayName, emailVerified } }
```

### Manual Test: Code Entry Flow

```bash
# 1. Request token (same as above)
curl -X POST http://localhost:8080/api/auth/passwordless/request \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com"}'

# Extract code from email log: e.g., "123 456" → use as "123456"

# 2. Verify via code
curl -X POST http://localhost:8080/api/auth/passwordless/verify \
  -H 'Content-Type: application/json' \
  -d '{"code":"123456"}'

# Returns: { user: { uid, email, displayName, emailVerified } }
# Session cookie set automatically
```

### Test with Driver

```bash
# Start the app and driver
npx vite --port 5173 --strictPort &
node .claude/skills/run-flygaca/driver.mjs <<'EOF'
goto /account
fill css=input[type="email"] test@example.com
click "Send me a sign-in code"
wait "Check your email"
text
EOF
```

## Security Considerations

### Enumeration Prevention

- `/passwordless/request` always returns 200, never reveals if email exists
- Logging happens after token creation (no leak via timing)
- Code collisions: 24-bit code = ~1 in 16.7M; probability acceptable

### Token Security

- Tokens are 32 bytes (256 bits) of random data — unguessable
- Hashed before storage (same pattern as email verify / password reset)
- Single-use: consumed by atomic UPDATE with `used_at IS NULL`
- Short TTL (10 minutes): window for interception is small

### Signup Autoaccounts

When a code is consumed for a new email:
- Account is created with `email_verified = true` (code proves control)
- No separate verification step needed
- User can set password later (optional)

### Rate Limiting

- Per-IP: 20 requests per 15 min (shared with password login)
- Per-email: 5 pending tokens max (checked before generation)
- Code guessing: 20 attempts per 15 min per IP (same as password login)

## PDPL Compliance

All passwordless events are recorded in the immutable audit trail:
- Event type (signin request, verify, etc.)
- User ID (if signing in) or email (if signing up)
- Client IP and user-agent
- Result and reason
- Timestamp (for investigation and breach notification)

No sensitive data is logged:
- Tokens are never stored unhashed
- Codes are stored (needed for verification) but cleared on use
- No password equivalent

## Future Enhancements

1. **SMS as alternative transport** — One-time code via text message
2. **Biometric linking** — "Sign in with fingerprint" on mobile, backed by passwordless
3. **Magic link expiry customization** — Longer TTL for enterprise users
4. **Analytics dashboard** — Signin methods distribution, code abandonment rates
5. **WebAuthn fallback** — Passwordless with FIDO2 (requires browser support)

## See Also

- `server/src/passwordless-core.ts` — Token generation, policy constants
- `server/src/routes/auth.ts` — Route implementations
- `server/src/store.ts` — Database functions
- `server/src/mail.ts` — Email sending
- `server/migrations/0005_passwordless_signin.sql` — Schema
