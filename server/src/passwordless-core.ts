/**
 * Passwordless authentication policy — token generation, code formatting, validation.
 *
 * Three authentication flows:
 * 1. Magic link: email contains a URL with token → click to auto-signin
 * 2. One-time code: email shows 6-digit code → user enters manually
 * 3. Both: token is long (32 bytes), code is short (3 bytes) from same random source
 *
 * Both are single-use, time-limited (10 minutes), and tracked in `passwordless_tokens`.
 * On successful consumption, a session is created immediately (no password/email-verify step).
 */

import { randomBytes } from "node:crypto";

const MAGIC_LINK_TOKEN_BYTES = 32;
const ONE_TIME_CODE_BYTES = 3; // 24 bits → 2^24 = ~16.7M codes, 6-digit readable

/**
 * Generate a passwordless token and one-time code from the same random source.
 * Returns both the unhashed token (for the magic link) and the formatted code.
 */
export function generatePasswordlessToken(): {
  token: string;
  code: string;
  codeDisplay: string;
} {
  const tokenBytes = randomBytes(MAGIC_LINK_TOKEN_BYTES);
  const codeBytes = randomBytes(ONE_TIME_CODE_BYTES);

  const token = tokenBytes.toString("hex");
  const codeNum = codeBytes.readUIntBE(0, 3); // 24-bit unsigned int
  const code = String(codeNum).padStart(6, "0");
  const codeDisplay = `${code.slice(0, 3)} ${code.slice(3, 6)}`; // "123 456" format

  return { token, code, codeDisplay };
}

/**
 * Time limit for passwordless tokens. Magic links and codes expire after this
 * period. Much shorter than email verification (24 hours) since the user is
 * actively requesting authentication right now.
 */
export const PASSWORD_LESS_TTL_MINUTES = 10;

/**
 * Rate limit: maximum passwordless requests per email per 24 hours.
 * Prevents spam and account enumeration via exhaustive signups.
 */
export const PASSWORD_LESS_MAX_PER_EMAIL_PER_DAY = 5;
