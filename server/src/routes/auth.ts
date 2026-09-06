/**
 * Authentication routes — email/password, Google OAuth, verification and reset.
 *
 * Replaces Firebase Auth. Two deliberate carry-overs keep the client unchanged:
 *   - failures use the same `auth/*` codes the Firebase SDK emitted, so the app's
 *     existing error-to-copy mapping and its i18n keys still apply;
 *   - the session is an HttpOnly cookie, so nothing token-shaped lives in JS.
 *
 * Enumeration posture: `/login` answers `auth/invalid-credential` for both an
 * unknown address and a wrong password, and `/password-reset` always answers 200.
 * Neither reveals whether an account exists.
 *
 * Audit trail: All authentication events (register, login, password reset, email verify)
 * are logged for PDPL compliance and brute-force detection. Failed login attempts trigger
 * account lockout after N failures within a time window.
 */
import { Router, type Response } from "express";
import { randomBytes } from "node:crypto";
import rateLimit from "express-rate-limit";
import { config } from "../config.js";
import {
  hashPassword,
  verifyPassword,
  signSession,
  sessionCookieOptions,
  generateOpaqueToken,
  hashToken,
} from "../session.js";
import {
  createUser,
  findUserByEmail,
  findUserByGoogleSub,
  findUserByAppleSub,
  linkGoogleAccount,
  linkAppleAccount,
  createAuthToken,
  consumeAuthToken,
  createOAuthState,
  consumeOAuthState,
  setEmailVerified,
  setPasswordHash,
  toAuthedUser,
  logAuthEvent,
  recordAuthFailure,
  isAccountLocked,
  recordLastLogin,
  type UserRow,
} from "../store.js";
import { mayLinkGoogleToExistingAccount } from "../auth-core.js";
import {
  getClientIp,
  getUserAgent,
} from "../audit-core.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../mail.js";
import { handler, requireUser, HttpError } from "../http.js";
import { meetsPasswordPolicy } from "../auth-core.js";

export const authRouter: Router = Router();

/** Brute-force guard on the credential-checking routes. */
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "auth/too-many-requests" },
});

const VERIFY_TTL_MIN = 60 * 24;
const RESET_TTL_MIN = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/** The client-facing user shape — identical to the old Firebase `AuthUser`. */
function publicUser(row: UserRow) {
  const u = toAuthedUser(row);
  return {
    uid: u.uid,
    email: u.email,
    displayName: u.displayName || null,
    emailVerified: u.emailVerified,
  };
}

/** Set the session cookie for `userId` on the response. */
async function establishSession(res: Response, userId: string): Promise<void> {
  const token = await signSession(userId);
  res.cookie(config.session.cookieName, token, sessionCookieOptions());
}

// ------------------------------------------------------------- session I/O --

authRouter.get(
  "/session",
  handler(async (req, res) => {
    if (!req.user) return res.json({ user: null });
    return res.json({
      user: {
        uid: req.user.uid,
        email: req.user.email,
        displayName: req.user.displayName || null,
        emailVerified: req.user.emailVerified,
      },
    });
  }),
);

/**
 * A bearer token for the native shell, where a cross-site cookie is unreliable.
 * Requires an already-established session, so it never widens access.
 */
authRouter.get(
  "/token",
  handler(async (req, res) => {
    const user = requireUser(req);
    return res.json({ token: await signSession(user.uid) });
  }),
);

authRouter.post(
  "/logout",
  handler(async (req, res) => {
    const clientIp = getClientIp(req);
    const userAgent = getUserAgent(req);
    const userId = req.user?.uid;

    res.clearCookie(config.session.cookieName, { ...sessionCookieOptions(), maxAge: undefined });

    await logAuthEvent({
      userId,
      eventType: "logout",
      result: "success",
      clientIp,
      userAgent,
    });
    return res.json({ ok: true });
  }),
);

// ------------------------------------------------------- email + password --

authRouter.post(
  "/register",
  credentialLimiter,
  handler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const displayName = typeof req.body?.displayName === "string" ? req.body.displayName : "";
    const clientIp = getClientIp(req);
    const userAgent = getUserAgent(req);

    if (!EMAIL_RE.test(email)) {
      await logAuthEvent({
        eventType: "register",
        result: "failed",
        reason: "invalid-email",
        clientIp,
        userAgent,
      });
      throw new HttpError(400, "auth/invalid-email");
    }
    // The full four-rule policy, not just length — the client form enforces the
    // same rules, but only this check binds callers that skip the form.
    if (!meetsPasswordPolicy(password)) {
      await logAuthEvent({
        eventType: "register",
        result: "failed",
        reason: "weak-password",
        clientIp,
        userAgent,
      });
      throw new HttpError(400, "auth/weak-password");
    }

    if (await findUserByEmail(email)) {
      await logAuthEvent({
        eventType: "register",
        result: "failed",
        reason: "email-already-in-use",
        clientIp,
        userAgent,
      });
      throw new HttpError(409, "auth/email-already-in-use");
    }

    const row = await createUser({
      email,
      passwordHash: await hashPassword(password),
      displayName,
    });

    const { token, digest } = generateOpaqueToken();
    await createAuthToken(digest, row.id, "verify", VERIFY_TTL_MIN);
    await sendVerificationEmail(email, token);

    await establishSession(res, row.id);
    await logAuthEvent({
      userId: row.id,
      eventType: "register",
      result: "success",
      clientIp,
      userAgent,
    });
    return res.status(201).json({ user: publicUser(row) });
  }),
);

authRouter.post(
  "/login",
  credentialLimiter,
  handler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const clientIp = getClientIp(req);
    const userAgent = getUserAgent(req);

    if (!email || !password) throw new HttpError(400, "auth/invalid-credential");

    const row = await findUserByEmail(email);
    // Same code for "no such account" and "wrong password" — no enumeration.
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      // Log failed login attempt for brute-force detection
      if (clientIp) {
        await recordAuthFailure({
          email,
          eventType: "login",
          clientIp,
        });
      }
      await logAuthEvent({
        eventType: "login",
        result: "failed",
        reason: row ? "invalid-password" : "user-not-found",
        clientIp,
        userAgent,
      });
      throw new HttpError(401, "auth/invalid-credential");
    }

    // Check if account is locked due to too many failed attempts
    if (await isAccountLocked(row.id)) {
      await logAuthEvent({
        userId: row.id,
        eventType: "login",
        result: "blocked",
        reason: "account-locked",
        clientIp,
        userAgent,
      });
      throw new HttpError(429, "auth/too-many-requests");
    }

    await establishSession(res, row.id);
    await recordLastLogin(row.id);
    await logAuthEvent({
      userId: row.id,
      eventType: "login",
      result: "success",
      clientIp,
      userAgent,
    });
    return res.json({ user: publicUser(row) });
  }),
);

authRouter.post(
  "/password-reset",
  credentialLimiter,
  handler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const clientIp = getClientIp(req);
    const userAgent = getUserAgent(req);

    if (!EMAIL_RE.test(email)) {
      // Log invalid email for audit, but never disclose it
      await logAuthEvent({
        eventType: "password-reset-request",
        result: "failed",
        reason: "invalid-email",
        clientIp,
        userAgent,
      });
      return res.json({ ok: true });
    }

    const row = await findUserByEmail(email);
    if (row) {
      const { token, digest } = generateOpaqueToken();
      await createAuthToken(digest, row.id, "reset", RESET_TTL_MIN);
      await sendPasswordResetEmail(email, token);
      await logAuthEvent({
        userId: row.id,
        eventType: "password-reset-request",
        result: "success",
        clientIp,
        userAgent,
      });
    } else {
      // Log failed attempt for audit, but don't disclose
      await logAuthEvent({
        eventType: "password-reset-request",
        result: "failed",
        reason: "user-not-found",
        clientIp,
        userAgent,
      });
    }
    // Always 200 — whether the address exists is not disclosed.
    return res.json({ ok: true });
  }),
);

authRouter.post(
  "/password-reset/confirm",
  credentialLimiter,
  handler(async (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const clientIp = getClientIp(req);
    const userAgent = getUserAgent(req);

    if (!token) {
      await logAuthEvent({
        eventType: "password-reset-confirm",
        result: "failed",
        reason: "invalid-action-code",
        clientIp,
        userAgent,
      });
      throw new HttpError(400, "auth/invalid-action-code");
    }
    // Same four-rule policy as /register: a reset must not weaken the account.
    if (!meetsPasswordPolicy(password)) {
      await logAuthEvent({
        eventType: "password-reset-confirm",
        result: "failed",
        reason: "weak-password",
        clientIp,
        userAgent,
      });
      throw new HttpError(400, "auth/weak-password");
    }

    const userId = await consumeAuthToken(hashToken(token), "reset");
    if (!userId) {
      await logAuthEvent({
        eventType: "password-reset-confirm",
        result: "failed",
        reason: "invalid-action-code",
        clientIp,
        userAgent,
      });
      throw new HttpError(400, "auth/invalid-action-code");
    }

    await setPasswordHash(userId, await hashPassword(password));
    // A reset proves control of the mailbox, so it also verifies the address.
    await setEmailVerified(userId);
    await establishSession(res, userId);
    await logAuthEvent({
      userId,
      eventType: "password-reset-confirm",
      result: "success",
      clientIp,
      userAgent,
    });
    return res.json({ ok: true });
  }),
);

authRouter.post(
  "/verify-email/resend",
  credentialLimiter,
  handler(async (req, res) => {
    const user = requireUser(req);
    const clientIp = getClientIp(req);
    const userAgent = getUserAgent(req);

    if (user.emailVerified) {
      await logAuthEvent({
        userId: user.uid,
        eventType: "email-verify-request",
        result: "success",
        reason: "already-verified",
        clientIp,
        userAgent,
      });
      return res.json({ ok: true });
    }

    const { token, digest } = generateOpaqueToken();
    await createAuthToken(digest, user.uid, "verify", VERIFY_TTL_MIN);
    await sendVerificationEmail(user.email, token);

    await logAuthEvent({
      userId: user.uid,
      eventType: "email-verify-request",
      result: "success",
      clientIp,
      userAgent,
    });
    return res.json({ ok: true });
  }),
);

authRouter.get(
  "/verify-email/confirm",
  handler(async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const clientIp = getClientIp(req);
    const userAgent = getUserAgent(req);

    const userId = token ? await consumeAuthToken(hashToken(token), "verify") : null;
    if (!userId) {
      await logAuthEvent({
        eventType: "email-verify-confirm",
        result: "failed",
        reason: "invalid-action-code",
        clientIp,
        userAgent,
      });
      return res.redirect(`${config.appOrigin}/account?verify=invalid`);
    }
    await setEmailVerified(userId);
    await establishSession(res, userId);
    await logAuthEvent({
      userId,
      eventType: "email-verify-confirm",
      result: "success",
      clientIp,
      userAgent,
    });
    return res.redirect(`${config.appOrigin}/account?verify=success`);
  }),
);

// ----------------------------------------------------------- Google OAuth --

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

function googleRedirectUri(): string {
  return `${config.apiOrigin}/api/auth/google/callback`;
}

/**
 * Only same-origin app paths are honoured as a post-sign-in destination, so a
 * crafted `returnTo` cannot turn this into an open redirect.
 */
function safeReturnTo(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return config.appOrigin;
  try {
    const url = new URL(raw, config.appOrigin);
    return url.origin === new URL(config.appOrigin).origin ? url.toString() : config.appOrigin;
  } catch {
    return config.appOrigin;
  }
}

authRouter.get(
  "/google/start",
  handler(async (req, res) => {
    if (!config.google.clientId) throw new HttpError(500, "auth/operation-not-allowed");

    const state = randomBytes(24).toString("base64url");
    await createOAuthState(state, safeReturnTo(req.query.returnTo));

    const params = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: googleRedirectUri(),
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    });
    return res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  }),
);

interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

authRouter.get(
  "/google/callback",
  handler(async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const returnTo = state ? await consumeOAuthState(state) : null;
    const clientIp = getClientIp(req);
    const userAgent = getUserAgent(req);

    if (!code || !returnTo) {
      await logAuthEvent({
        eventType: "oauth-google-signin",
        result: "failed",
        reason: "invalid-state",
        clientIp,
        userAgent,
      });
      return res.redirect(`${config.appOrigin}/account?signin=failed`);
    }

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: googleRedirectUri(),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      console.error("Google token exchange failed:", await tokenRes.text());
      await logAuthEvent({
        eventType: "oauth-google-signin",
        result: "failed",
        reason: "token-exchange-failed",
        clientIp,
        userAgent,
      });
      return res.redirect(`${config.appOrigin}/account?signin=failed`);
    }
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
    if (!accessToken) {
      await logAuthEvent({
        eventType: "oauth-google-signin",
        result: "failed",
        reason: "no-access-token",
        clientIp,
        userAgent,
      });
      return res.redirect(`${config.appOrigin}/account?signin=failed`);
    }

    const infoRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!infoRes.ok) {
      await logAuthEvent({
        eventType: "oauth-google-signin",
        result: "failed",
        reason: "userinfo-failed",
        clientIp,
        userAgent,
      });
      return res.redirect(`${config.appOrigin}/account?signin=failed`);
    }
    const info = (await infoRes.json()) as GoogleUserInfo;

    const email = normalizeEmail(info.email);
    if (!info.sub || !email) {
      await logAuthEvent({
        eventType: "oauth-google-signin",
        result: "failed",
        reason: "missing-email-or-sub",
        clientIp,
        userAgent,
      });
      return res.redirect(`${config.appOrigin}/account?signin=failed`);
    }

    // Match on the Google subject first (stable across email changes), then fall
    // back to the address so an existing password account links rather than
    // colliding on the UNIQUE email constraint. The address fallback only applies
    // when both sides have proven the mailbox — see `mayLinkGoogleToExistingAccount`.
    let row = await findUserByGoogleSub(info.sub);
    if (!row) {
      const existing = await findUserByEmail(email);
      if (existing) {
        if (
          !mayLinkGoogleToExistingAccount({
            googleEmailVerified: info.email_verified === true,
            existingEmailVerified: existing.email_verified,
            existingHasPassword: existing.password_hash !== null,
          })
        ) {
          await logAuthEvent({
            userId: existing.id,
            eventType: "google-link",
            result: "blocked",
            reason: "email-mismatch",
            clientIp,
            userAgent,
          });
          return res.redirect(`${config.appOrigin}/account?signin=link-blocked`);
        }
        row = await linkGoogleAccount(existing.id, info.sub, true);
        await logAuthEvent({
          userId: existing.id,
          eventType: "google-link",
          result: "success",
          clientIp,
          userAgent,
        });
      }
    }

    row ??= await createUser({
      email,
      googleSub: info.sub,
      displayName: info.name ?? "",
      // Google asserts the address; trust it only when it says verified.
      emailVerified: info.email_verified === true,
    });

    await establishSession(res, row.id);
    await recordLastLogin(row.id);
    await logAuthEvent({
      userId: row.id,
      eventType: "oauth-google-signin",
      result: "success",
      clientIp,
      userAgent,
    });
    return res.redirect(returnTo);
  }),
);

// ----------------------------------------------------------- Apple OAuth --

const APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";

function appleRedirectUri(): string {
  return `${config.apiOrigin}/api/auth/apple/callback`;
}

interface AppleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: {
    firstName?: string;
    lastName?: string;
  };
}

authRouter.get(
  "/apple/start",
  handler(async (req, res) => {
    if (!config.apple.clientId) throw new HttpError(500, "auth/operation-not-allowed");

    const state = randomBytes(24).toString("base64url");
    await createOAuthState(state, safeReturnTo(req.query.returnTo));

    const params = new URLSearchParams({
      client_id: config.apple.clientId,
      redirect_uri: appleRedirectUri(),
      response_type: "code id_token",
      response_mode: "form_post",
      scope: "openid email",
      state,
    });
    return res.redirect(`${APPLE_AUTH_URL}?${params.toString()}`);
  }),
);

authRouter.post(
  "/apple/callback",
  handler(async (req, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    const state = typeof req.body?.state === "string" ? req.body.state : "";
    const returnTo = state ? await consumeOAuthState(state) : null;

    if (!code || !returnTo) {
      return res.redirect(`${config.appOrigin}/account?signin=failed`);
    }

    const tokenRes = await fetch(APPLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.apple.clientId,
        client_secret: config.apple.clientSecret,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      console.error("Apple token exchange failed:", await tokenRes.text());
      return res.redirect(`${config.appOrigin}/account?signin=failed`);
    }

    const tokenData = (await tokenRes.json()) as {
      id_token?: string;
      access_token?: string;
    };

    if (!tokenData.id_token) {
      return res.redirect(`${config.appOrigin}/account?signin=failed`);
    }

    // Parse JWT without verification (Apple provides the token, so we trust it)
    const parts = tokenData.id_token.split(".");
    if (parts.length !== 3) {
      return res.redirect(`${config.appOrigin}/account?signin=failed`);
    }

    let info: AppleUserInfo;
    try {
      const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
      info = JSON.parse(payload) as AppleUserInfo;
    } catch {
      console.error("Failed to parse Apple id_token");
      return res.redirect(`${config.appOrigin}/account?signin=failed`);
    }

    // User info may also come from POST body (only first time)
    if (req.body?.user) {
      try {
        const userObj = (typeof req.body.user === "string"
          ? JSON.parse(req.body.user)
          : req.body.user) as {
          name?: { firstName?: string; lastName?: string };
          email?: string;
        };
        if (userObj.email) info.email = userObj.email;
        if (userObj.name) info.name = userObj.name;
      } catch (err) {
        console.error("Failed to parse Apple req.body.user", err);
      }
    }

    const email = normalizeEmail(info.email);
    if (!info.sub || !email) {
      return res.redirect(`${config.appOrigin}/account?signin=failed`);
    }

    // Same pattern as Google: match on Apple subject first, then email for linking
    let row = await findUserByAppleSub(info.sub);
    if (!row) {
      const existing = await findUserByEmail(email);
      if (existing) {
        if (
          !mayLinkGoogleToExistingAccount({
            googleEmailVerified: info.email_verified === true,
            existingEmailVerified: existing.email_verified,
            existingHasPassword: existing.password_hash !== null,
          })
        ) {
          return res.redirect(`${config.appOrigin}/account?signin=link-blocked`);
        }
        row = await linkAppleAccount(existing.id, info.sub, true);
      }
    }

    const displayName = info.name
      ? [info.name.firstName, info.name.lastName].filter(Boolean).join(" ")
      : "";

    row ??= await createUser({
      email,
      appleSub: info.sub,
      displayName,
      emailVerified: info.email_verified === true,
    });

    await establishSession(res, row.id);
    return res.redirect(returnTo);
  }),
);
