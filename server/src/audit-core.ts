/**
 * Authentication audit and security tracking — PDPL compliance, investigation, anomaly detection.
 *
 * All authentication events are logged (success/failure/blocked), with failure tracking
 * enabling brute-force detection. Account lockout is applied after N failed attempts
 * within a time window.
 *
 * This module is the pure policy layer — the actual recording is in store.ts.
 */

export interface AuthEventLog {
  userId?: string;
  eventType:
    | "register"
    | "login"
    | "logout"
    | "password-reset-request"
    | "password-reset-confirm"
    | "email-verify-request"
    | "email-verify-confirm"
    | "google-link"
    | "apple-link"
    | "oauth-google-signin"
    | "oauth-apple-signin"
    | "passwordless-signin-request"
    | "passwordless-signup-request"
    | "passwordless-verify";
  result: "success" | "failed" | "blocked";
  reason?: string;
  clientIp?: string;
  userAgent?: string;
}

/**
 * Brute-force detection thresholds.
 * Configurable via environment but defaults are NIST-adjacent:
 * - 20 failed logins per 15 min per account → lock 30 min (matches rate limiter window)
 * - 10 failed logins per 15 min per IP → may warrant block (adjust as needed)
 * - 5 registration attempts per 15 min per IP → may warrant investigation
 */
export interface BruteForcePolicy {
  loginFailuresPerAccount: number; // default: 20
  loginFailuresPerIp: number; // default: 10
  registrationAttemptsPerIp: number; // default: 5
  lockoutDurationMs: number; // default: 30 * 60 * 1000 (30 min)
  windowMs: number; // default: 15 * 60 * 1000 (15 min)
}

export const defaultBruteForcePolicy: BruteForcePolicy = {
  loginFailuresPerAccount: 20,
  loginFailuresPerIp: 10,
  registrationAttemptsPerIp: 5,
  lockoutDurationMs: 30 * 60 * 1000,
  windowMs: 15 * 60 * 1000,
};

/**
 * Check if an account should be locked out due to too many failed login attempts.
 * @param recentFailures Number of login failures for this account in the last window
 * @returns { locked: boolean, lockUntil?: Date } — if locked, when the lockout expires
 */
export function shouldLockAccount(
  recentFailures: number,
  policy: BruteForcePolicy = defaultBruteForcePolicy,
): { locked: boolean; lockUntil?: Date } {
  if (recentFailures >= policy.loginFailuresPerAccount) {
    return {
      locked: true,
      lockUntil: new Date(Date.now() + policy.lockoutDurationMs),
    };
  }
  return { locked: false };
}

/**
 * Check if an IP address should be rate-limited for login attempts.
 * Called by the rate limiter; this just provides the policy decision.
 */
export function shouldRateLimitLoginIp(
  recentFailures: number,
  policy: BruteForcePolicy = defaultBruteForcePolicy,
): boolean {
  return recentFailures >= policy.loginFailuresPerIp;
}

/**
 * Check if an IP address should be rate-limited for registration attempts.
 * Registration is less expensive than password verification, so apply a tighter threshold.
 */
export function shouldRateLimitRegistrationIp(
  recentAttempts: number,
  policy: BruteForcePolicy = defaultBruteForcePolicy,
): boolean {
  return recentAttempts >= policy.registrationAttemptsPerIp;
}

/**
 * The message to send when an account is locked due to failed attempts.
 * Matches the Firebase error code so the client's i18n mapping still works.
 */
export function accountLockedMessage(): string {
  return "auth/too-many-requests";
}

/**
 * Parse client IP from request headers, accounting for Cloud Run / Google proxy.
 * When trust proxy is set to 1 (only the last hop), Express.request.ip is correct.
 */
export function getClientIp(req: any): string | undefined {
  // Express normalizes this when `app.set('trust proxy', 1)` is set
  return req.ip || req.connection?.remoteAddress;
}

/**
 * Extract user-agent string from request.
 */
export function getUserAgent(req: any): string | undefined {
  return req.get("user-agent");
}
