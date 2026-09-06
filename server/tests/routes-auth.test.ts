/**
 * `server/src/routes/auth.ts` — registration, sign-in, verification, password
 * reset and the Google OAuth dance.
 *
 * The last of the entitlement-adjacent routes to leave the coverage exclude
 * list, and the one carrying the most unasserted security posture: the
 * deliberate anti-enumeration answers (`/login` returns the same code for an
 * unknown address and a wrong password; `/password-reset` always answers 200),
 * the `auth/*` codes the client's error-copy layer depends on, single-use reset
 * tokens stored only as digests, and `safeReturnTo`'s open-redirect guard on the
 * OAuth callback.
 *
 * The real router runs on a real Express app. `store.ts` and `mail.ts` are
 * mocked as the I/O edges and `fetch` is stubbed for Google; `session.ts` and
 * `config.ts` are the real ones (driven by env set before import), so the cookie
 * and JWT behaviour is genuinely exercised rather than faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// Skip rate limiter in tests before modules are imported
process.env.SKIP_RATE_LIMIT_IN_TESTS = "true";
process.env.SESSION_SECRET = "test-session-secret";
process.env.APP_ORIGIN = "https://flygaca.com";
process.env.API_ORIGIN = "https://api.flygaca.com";
process.env.GOOGLE_OAUTH_CLIENT_ID = "google-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-client-secret";
process.env.APPLE_OAUTH_CLIENT_ID = "apple-client-id";
process.env.APPLE_OAUTH_CLIENT_SECRET = "apple-client-secret";

const createUser = vi.fn();
const findUserByEmail = vi.fn();
const findUserByGoogleSub = vi.fn();
const findUserByAppleSub = vi.fn();
const linkGoogleAccount = vi.fn();
const linkAppleAccount = vi.fn();
const createAuthToken = vi.fn();
const consumeAuthToken = vi.fn();
const createOAuthState = vi.fn();
const consumeOAuthState = vi.fn();
const setEmailVerified = vi.fn();
const setPasswordHash = vi.fn();
const logAuthEvent = vi.fn();
const recordAuthFailure = vi.fn();
const isAccountLocked = vi.fn();
const recordLastLogin = vi.fn();
const createPasswordlessToken = vi.fn();
const consumePasswordlessToken = vi.fn();
const consumePasswordlessCode = vi.fn();
const getPendingPasswordlessToken = vi.fn();
const sendVerificationEmail = vi.fn();
const sendPasswordResetEmail = vi.fn();
const sendPasswordlessSigninEmail = vi.fn();

vi.mock("../src/store.js", () => ({
  createUser: (...a: unknown[]) => createUser(...a),
  findUserByEmail: (...a: unknown[]) => findUserByEmail(...a),
  findUserByGoogleSub: (...a: unknown[]) => findUserByGoogleSub(...a),
  findUserByAppleSub: (...a: unknown[]) => findUserByAppleSub(...a),
  linkGoogleAccount: (...a: unknown[]) => linkGoogleAccount(...a),
  linkAppleAccount: (...a: unknown[]) => linkAppleAccount(...a),
  createAuthToken: (...a: unknown[]) => createAuthToken(...a),
  consumeAuthToken: (...a: unknown[]) => consumeAuthToken(...a),
  createOAuthState: (...a: unknown[]) => createOAuthState(...a),
  consumeOAuthState: (...a: unknown[]) => consumeOAuthState(...a),
  setEmailVerified: (...a: unknown[]) => setEmailVerified(...a),
  setPasswordHash: (...a: unknown[]) => setPasswordHash(...a),
  toAuthedUser: (row: {
    id: string;
    email: string;
    display_name?: string;
    email_verified?: boolean;
    created_at?: Date;
  }) => ({
    uid: row.id,
    email: row.email,
    displayName: row.display_name ?? "",
    emailVerified: row.email_verified ?? false,
    createdAtMs: row.created_at?.getTime() ?? 0,
  }),
  logAuthEvent: (...a: unknown[]) => logAuthEvent(...a),
  recordAuthFailure: (...a: unknown[]) => recordAuthFailure(...a),
  isAccountLocked: (...a: unknown[]) => isAccountLocked(...a),
  recordLastLogin: (...a: unknown[]) => recordLastLogin(...a),
  createPasswordlessToken: (...a: unknown[]) => createPasswordlessToken(...a),
  consumePasswordlessToken: (...a: unknown[]) => consumePasswordlessToken(...a),
  consumePasswordlessCode: (...a: unknown[]) => consumePasswordlessCode(...a),
  getPendingPasswordlessToken: (...a: unknown[]) => getPendingPasswordlessToken(...a),
}));
vi.mock("../src/mail.js", () => ({
  sendVerificationEmail: (...a: unknown[]) => sendVerificationEmail(...a),
  sendPasswordResetEmail: (...a: unknown[]) => sendPasswordResetEmail(...a),
  sendPasswordlessSigninEmail: (...a: unknown[]) => sendPasswordlessSigninEmail(...a),
}));

const { authRouter } = await import("../src/routes/auth.js");
const { errorMiddleware } = await import("../src/http.js");
const { hashPassword, hashToken } = await import("../src/session.js");

let currentUser: { uid: string; email: string; emailVerified: boolean } | null = null;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  if (currentUser) req.user = currentUser as never;
  next();
});
app.use("/api/auth", authRouter);
app.use(errorMiddleware);

/** A `users` row as the store returns it. */
function userRow(over: Record<string, unknown> = {}) {
  return {
    id: "u1",
    email: "cadet@example.com",
    display_name: "Cadet",
    email_verified: false,
    password_hash: null,
    created_at: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

/** True when the response set the session cookie. */
function setsSession(res: request.Response): boolean {
  const cookies = res.headers["set-cookie"] ?? [];
  return (cookies as string[]).some((c) => c.startsWith("fg_session=") && !c.includes("fg_session=;"));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  currentUser = null;
  findUserByEmail.mockResolvedValue(null);
  findUserByGoogleSub.mockResolvedValue(null);
  linkGoogleAccount.mockResolvedValue(null);
  createUser.mockResolvedValue(userRow());
  createAuthToken.mockResolvedValue(undefined);
  consumeAuthToken.mockResolvedValue(null);
  createOAuthState.mockResolvedValue(undefined);
  consumeOAuthState.mockResolvedValue(null);
  setEmailVerified.mockResolvedValue(undefined);
  setPasswordHash.mockResolvedValue(undefined);
  logAuthEvent.mockResolvedValue(undefined);
  recordAuthFailure.mockResolvedValue(undefined);
  isAccountLocked.mockResolvedValue(false);
  recordLastLogin.mockResolvedValue(undefined);
  createPasswordlessToken.mockResolvedValue(undefined);
  consumePasswordlessToken.mockResolvedValue(null);
  consumePasswordlessCode.mockResolvedValue(null);
  getPendingPasswordlessToken.mockResolvedValue(null);
  sendVerificationEmail.mockResolvedValue(undefined);
  sendPasswordResetEmail.mockResolvedValue(undefined);
  sendPasswordlessSigninEmail.mockResolvedValue(undefined);
});

describe("GET /session", () => {
  it("reports the signed-in user", async () => {
    currentUser = { uid: "u1", email: "cadet@example.com", emailVerified: true };
    const res = await request(app).get("/api/auth/session");
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ uid: "u1", emailVerified: true });
  });

  it("reports a null user for an anonymous caller rather than 401ing", async () => {
    const res = await request(app).get("/api/auth/session");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
  });
});

describe("GET /token", () => {
  it("mints a bearer token for an established session", async () => {
    currentUser = { uid: "u1", email: "a@b.com", emailVerified: true };
    const res = await request(app).get("/api/auth/token");
    expect(res.status).toBe(200);
    expect(res.body.token.split(".")).toHaveLength(3); // a JWT
  });

  it("never widens access — 401 without a session", async () => {
    const res = await request(app).get("/api/auth/token");
    expect(res.status).toBe(401);
  });
});

describe("POST /logout", () => {
  it("clears the session cookie", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.body).toEqual({ ok: true });
    const cookies = (res.headers["set-cookie"] ?? []) as string[];
    expect(cookies.some((c) => c.startsWith("fg_session=;"))).toBe(true);
  });
});

describe("POST /register", () => {
  it("creates the account, sends verification and signs the user in", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "New.Cadet@Example.com ", password: "A-good-password1", displayName: "Cadet" });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ uid: "u1" });
    // Email is normalized before it is stored or looked up.
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email: "new.cadet@example.com" }));
    expect(sendVerificationEmail).toHaveBeenCalled();
    expect(setsSession(res)).toBe(true);
  });

  it("stores a hash, never the password itself", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ email: "a@b.com", password: "A-good-password1" });

    const [{ passwordHash }] = createUser.mock.calls[0] as [{ passwordHash: string }];
    expect(passwordHash).toMatch(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(passwordHash).not.toContain("A-good-password1");
  });

  it("emails the token but stores only its digest", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ email: "a@b.com", password: "A-good-password1" });

    const [digest] = createAuthToken.mock.calls[0] as [string];
    const [, emailedToken] = sendVerificationEmail.mock.calls[0] as [string, string];
    expect(digest).toBe(hashToken(emailedToken));
    expect(digest).not.toBe(emailedToken);
  });

  it("rejects a malformed address with auth/invalid-email", async () => {
    for (const email of ["", "not-an-email", "a@b", "a b@c.com"]) {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ email, password: "A-good-password1" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("auth/invalid-email");
    }
  });

  it("rejects a short password with auth/weak-password", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "a@b.com", password: "1234567" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("auth/weak-password");
    expect(createUser).not.toHaveBeenCalled();
  });

  it("enforces the full four-rule policy, not just length", async () => {
    // Long enough but missing mixed case / digit / special — each must fail,
    // exactly as the client sign-up form would reject it.
    for (const password of ["alllowercase1!", "NoDigitsHere!", "NoSpecial123a"]) {
      const res = await request(app).post("/api/auth/register").send({ email: "a@b.com", password });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("auth/weak-password");
    }
    expect(createUser).not.toHaveBeenCalled();
  });

  it("409s on a duplicate address without creating anything", async () => {
    findUserByEmail.mockResolvedValue(userRow());
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "a@b.com", password: "A-good-password1" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("auth/email-already-in-use");
    expect(createUser).not.toHaveBeenCalled();
  });
});

describe("POST /login", () => {
  it("signs in with the right password", async () => {
    findUserByEmail.mockResolvedValue(
      userRow({ password_hash: await hashPassword("A-good-password1") }),
    );

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "cadet@example.com", password: "A-good-password1" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ uid: "u1" });
    expect(setsSession(res)).toBe(true);
  });

  it("gives the same answer for an unknown address and a wrong password", async () => {
    // The anti-enumeration rule: neither response reveals whether the account
    // exists, so they must be indistinguishable.
    findUserByEmail.mockResolvedValue(null);
    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "A-good-password1" });

    findUserByEmail.mockResolvedValue(
      userRow({ password_hash: await hashPassword("the-real-password") }),
    );
    const wrong = await request(app)
      .post("/api/auth/login")
      .send({ email: "cadet@example.com", password: "A-good-password1" });

    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual({ error: "auth/invalid-credential", message: "auth/invalid-credential" });
    expect(wrong.status).toBe(unknown.status);
    expect(wrong.body).toEqual(unknown.body);
    expect(setsSession(wrong)).toBe(false);
  });

  it("refuses an OAuth-only account, which has no password hash", async () => {
    findUserByEmail.mockResolvedValue(userRow({ password_hash: null }));
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "cadet@example.com", password: "anything" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("auth/invalid-credential");
  });

  it("400s on a missing field without touching the store", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "a@b.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("auth/invalid-credential");
    expect(findUserByEmail).not.toHaveBeenCalled();
  });
});

describe("POST /password-reset", () => {
  it("sends a reset link for a known address", async () => {
    findUserByEmail.mockResolvedValue(userRow());
    const res = await request(app).post("/api/auth/password-reset").send({ email: "a@b.com" });

    expect(res.body).toEqual({ ok: true });
    expect(sendPasswordResetEmail).toHaveBeenCalled();
    const [digest] = createAuthToken.mock.calls[0] as [string];
    const [, emailed] = sendPasswordResetEmail.mock.calls[0] as [string, string];
    expect(digest).toBe(hashToken(emailed));
  });

  it("answers identically for an unknown address, sending nothing", async () => {
    findUserByEmail.mockResolvedValue(null);
    const res = await request(app).post("/api/auth/password-reset").send({ email: "a@b.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("answers 200 for a malformed address (anti-enumeration)", async () => {
    const res = await request(app).post("/api/auth/password-reset").send({ email: "nope" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});

describe("POST /password-reset/confirm", () => {
  it("sets the new password, verifies the address and signs the user in", async () => {
    consumeAuthToken.mockResolvedValue("u1");

    const res = await request(app)
      .post("/api/auth/password-reset/confirm")
      .send({ token: "opaque-token", password: "A-new-password1" });

    expect(res.body).toEqual({ ok: true });
    // A reset proves control of the mailbox, so it also verifies the address.
    expect(setEmailVerified).toHaveBeenCalledWith("u1");
    expect(setsSession(res)).toBe(true);
    const [, hash] = setPasswordHash.mock.calls[0] as [string, string];
    expect(hash).toMatch(/^scrypt\$/);
  });

  it("looks the token up by digest, never by the token itself", async () => {
    consumeAuthToken.mockResolvedValue("u1");
    await request(app)
      .post("/api/auth/password-reset/confirm")
      .send({ token: "opaque-token", password: "A-new-password1" });

    expect(consumeAuthToken).toHaveBeenCalledWith(hashToken("opaque-token"), "reset");
  });

  it("rejects a spent or unknown token", async () => {
    consumeAuthToken.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/auth/password-reset/confirm")
      .send({ token: "already-used", password: "A-new-password1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("auth/invalid-action-code");
    expect(setPasswordHash).not.toHaveBeenCalled();
  });

  it("enforces the password policy before spending the token", async () => {
    const res = await request(app)
      .post("/api/auth/password-reset/confirm")
      .send({ token: "opaque-token", password: "short" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("auth/weak-password");
    expect(consumeAuthToken).not.toHaveBeenCalled();
  });

  it("rejects a missing token", async () => {
    const res = await request(app)
      .post("/api/auth/password-reset/confirm")
      .send({ password: "A-new-password1" });
    expect(res.body.error).toBe("auth/invalid-action-code");
  });
});

describe("email verification", () => {
  it("resends for a signed-in unverified account", async () => {
    currentUser = { uid: "u1", email: "a@b.com", emailVerified: false };
    const res = await request(app).post("/api/auth/verify-email/resend");

    expect(res.body).toEqual({ ok: true });
    expect(sendVerificationEmail).toHaveBeenCalled();
  });

  it("is a no-op for an already-verified account", async () => {
    currentUser = { uid: "u1", email: "a@b.com", emailVerified: true };
    const res = await request(app).post("/api/auth/verify-email/resend");

    expect(res.body).toEqual({ ok: true });
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("requires a session to resend", async () => {
    const res = await request(app).post("/api/auth/verify-email/resend");
    expect(res.status).toBe(401);
  });

  it("verifies and signs in on a good confirm link", async () => {
    consumeAuthToken.mockResolvedValue("u1");
    const res = await request(app).get("/api/auth/verify-email/confirm?token=good");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://flygaca.com/account?verify=success");
    expect(setEmailVerified).toHaveBeenCalledWith("u1");
    expect(setsSession(res)).toBe(true);
  });

  it("redirects to an invalid marker for a spent or absent token", async () => {
    consumeAuthToken.mockResolvedValue(null);
    const bad = await request(app).get("/api/auth/verify-email/confirm?token=spent");
    expect(bad.headers.location).toBe("https://flygaca.com/account?verify=invalid");

    const none = await request(app).get("/api/auth/verify-email/confirm");
    expect(none.headers.location).toBe("https://flygaca.com/account?verify=invalid");
    expect(setEmailVerified).not.toHaveBeenCalled();
  });
});

describe("GET /google/start", () => {
  it("redirects to Google with a persisted state", async () => {
    const res = await request(app).get("/api/auth/google/start");

    expect(res.status).toBe(302);
    const url = new URL(res.headers.location);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("google-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://api.flygaca.com/api/auth/google/callback",
    );
    expect(url.searchParams.get("state")).toBe(
      (createOAuthState.mock.calls[0] as [string, string])[0],
    );
  });

  it("keeps a same-origin returnTo", async () => {
    await request(app).get("/api/auth/google/start?returnTo=/dashboard");
    const [, returnTo] = createOAuthState.mock.calls[0] as [string, string];
    expect(returnTo).toBe("https://flygaca.com/dashboard");
  });

  it("refuses a foreign returnTo — no open redirect", async () => {
    for (const raw of ["https://evil.example/steal", "//evil.example", "javascript:alert(1)"]) {
      createOAuthState.mockClear();
      await request(app).get(`/api/auth/google/start?returnTo=${encodeURIComponent(raw)}`);
      const [, returnTo] = createOAuthState.mock.calls[0] as [string, string];
      expect(returnTo).toBe("https://flygaca.com");
    }
  });
});

describe("GET /google/callback", () => {
  /** Stub the token exchange then the userinfo call. */
  function stubGoogle(info: Record<string, unknown>, tokenOk = true, infoOk = true) {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: tokenOk,
        json: async () => ({ access_token: "ya29.token" }),
        text: async () => "denied",
      })
      .mockResolvedValueOnce({ ok: infoOk, json: async () => info, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("signs in an existing Google account and honours the stored returnTo", async () => {
    consumeOAuthState.mockResolvedValue("https://flygaca.com/dashboard");
    findUserByGoogleSub.mockResolvedValue(userRow({ email_verified: true }));
    stubGoogle({ sub: "g1", email: "cadet@example.com", email_verified: true });

    const res = await request(app).get("/api/auth/google/callback?code=abc&state=s1");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://flygaca.com/dashboard");
    expect(setsSession(res)).toBe(true);
  });

  it("links Google onto an existing password account rather than colliding", async () => {
    consumeOAuthState.mockResolvedValue("https://flygaca.com/account");
    findUserByGoogleSub.mockResolvedValue(null);
    findUserByEmail.mockResolvedValue(userRow());
    linkGoogleAccount.mockResolvedValue(userRow({ email_verified: true }));
    stubGoogle({ sub: "g1", email: "cadet@example.com", email_verified: true });

    await request(app).get("/api/auth/google/callback?code=abc&state=s1");

    expect(linkGoogleAccount).toHaveBeenCalledWith("u1", "g1", true);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("creates a new account, trusting Google's verified flag only when set", async () => {
    consumeOAuthState.mockResolvedValue("https://flygaca.com/account");
    stubGoogle({ sub: "g2", email: "new@example.com", email_verified: false });

    await request(app).get("/api/auth/google/callback?code=abc&state=s1");

    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ emailVerified: false }));
  });

  it("fails closed on an unknown or replayed state", async () => {
    consumeOAuthState.mockResolvedValue(null); // already consumed
    const fetchMock = stubGoogle({ sub: "g1", email: "a@b.com" });

    const res = await request(app).get("/api/auth/google/callback?code=abc&state=replayed");

    expect(res.headers.location).toBe("https://flygaca.com/account?signin=failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed with no code", async () => {
    consumeOAuthState.mockResolvedValue("https://flygaca.com/account");
    const res = await request(app).get("/api/auth/google/callback?state=s1");
    expect(res.headers.location).toBe("https://flygaca.com/account?signin=failed");
  });

  it("fails closed when the token exchange is rejected", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    consumeOAuthState.mockResolvedValue("https://flygaca.com/account");
    stubGoogle({}, false);

    const res = await request(app).get("/api/auth/google/callback?code=abc&state=s1");

    expect(res.headers.location).toBe("https://flygaca.com/account?signin=failed");
    expect(createUser).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("fails closed when userinfo is rejected", async () => {
    consumeOAuthState.mockResolvedValue("https://flygaca.com/account");
    stubGoogle({}, true, false);

    const res = await request(app).get("/api/auth/google/callback?code=abc&state=s1");

    expect(res.headers.location).toBe("https://flygaca.com/account?signin=failed");
    expect(createUser).not.toHaveBeenCalled();
  });

  it("fails closed when Google returns no subject or no address", async () => {
    consumeOAuthState.mockResolvedValue("https://flygaca.com/account");
    stubGoogle({ sub: "", email: "a@b.com" });
    const noSub = await request(app).get("/api/auth/google/callback?code=abc&state=s1");
    expect(noSub.headers.location).toBe("https://flygaca.com/account?signin=failed");

    consumeOAuthState.mockResolvedValue("https://flygaca.com/account");
    stubGoogle({ sub: "g1" });
    const noEmail = await request(app).get("/api/auth/google/callback?code=abc&state=s1");
    expect(noEmail.headers.location).toBe("https://flygaca.com/account?signin=failed");
    expect(createUser).not.toHaveBeenCalled();
  });
});

describe("GET /apple/start", () => {
  it("redirects to Apple with a persisted state", async () => {
    const res = await request(app).get("/api/auth/apple/start");

    expect(res.status).toBe(302);
    const url = new URL(res.headers.location);
    expect(url.origin + url.pathname).toBe("https://appleid.apple.com/auth/authorize");
    expect(url.searchParams.get("client_id")).toBe("apple-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://api.flygaca.com/api/auth/apple/callback",
    );
    expect(url.searchParams.get("state")).toBe(
      (createOAuthState.mock.calls[0] as [string, string])[0],
    );
  });

  it("keeps a same-origin returnTo", async () => {
    await request(app).get("/api/auth/apple/start?returnTo=/dashboard");
    const [, returnTo] = createOAuthState.mock.calls[0] as [string, string];
    expect(returnTo).toBe("https://flygaca.com/dashboard");
  });

  it("refuses a foreign returnTo — no open redirect", async () => {
    for (const raw of ["https://evil.example/steal", "//evil.example", "javascript:alert(1)"]) {
      createOAuthState.mockClear();
      await request(app).get(`/api/auth/apple/start?returnTo=${encodeURIComponent(raw)}`);
      const [, returnTo] = createOAuthState.mock.calls[0] as [string, string];
      expect(returnTo).toBe("https://flygaca.com");
    }
  });
});

describe("POST /apple/callback", () => {
  /** Create a minimal valid Apple id_token JWT payload and base64-encode it. */
  function idTokenPayload(info: Record<string, unknown>) {
    const payload = Buffer.from(JSON.stringify(info)).toString("base64");
    return `header.${payload}.signature`;
  }

  /** Stub the token exchange to return an id_token. */
  function stubApple(idToken: string, tokenOk = true) {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: tokenOk,
        json: async () => ({ id_token: idToken }),
        text: async () => "denied",
      });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("signs in an existing Apple account and honours the stored returnTo", async () => {
    consumeOAuthState.mockResolvedValue("https://flygaca.com/dashboard");
    findUserByAppleSub.mockResolvedValue(userRow({ email_verified: true }));
    stubApple(idTokenPayload({ sub: "a1", email: "cadet@example.com", email_verified: true }));

    const res = await request(app)
      .post("/api/auth/apple/callback")
      .send({ code: "abc", state: "s1" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://flygaca.com/dashboard");
    expect(setsSession(res)).toBe(true);
  });

  it("links Apple onto an existing password account rather than colliding", async () => {
    consumeOAuthState.mockResolvedValue("https://flygaca.com/account");
    findUserByAppleSub.mockResolvedValue(null);
    findUserByEmail.mockResolvedValue(userRow());
    linkAppleAccount.mockResolvedValue(userRow({ email_verified: true }));
    stubApple(idTokenPayload({ sub: "a1", email: "cadet@example.com", email_verified: true }));

    await request(app)
      .post("/api/auth/apple/callback")
      .send({ code: "abc", state: "s1" });

    expect(linkAppleAccount).toHaveBeenCalledWith("u1", "a1", true);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("blocks linking when Apple tries to adopt an unverified password account", async () => {
    consumeOAuthState.mockResolvedValue("https://flygaca.com/account");
    findUserByAppleSub.mockResolvedValue(null);
    findUserByEmail.mockResolvedValue(userRow({ email_verified: false, password_hash: "hash" }));
    stubApple(idTokenPayload({ sub: "a1", email: "cadet@example.com", email_verified: true }));

    const res = await request(app)
      .post("/api/auth/apple/callback")
      .send({ code: "abc", state: "s1" });

    expect(res.headers.location).toBe("https://flygaca.com/account?signin=link-blocked");
    expect(linkAppleAccount).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  it("creates a new account, trusting Apple's verified flag only when set", async () => {
    consumeOAuthState.mockResolvedValue("https://flygaca.com/account");
    stubApple(idTokenPayload({ sub: "a2", email: "new@example.com", email_verified: false }));

    await request(app)
      .post("/api/auth/apple/callback")
      .send({ code: "abc", state: "s1" });

    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ emailVerified: false }));
  });

  it("accepts user info from POST body (first sign-in only)", async () => {
    consumeOAuthState.mockResolvedValue("https://flygaca.com/account");
    stubApple(idTokenPayload({ sub: "a3", email: "new@example.com", email_verified: true }));

    await request(app)
      .post("/api/auth/apple/callback")
      .send({
        code: "abc",
        state: "s1",
        user: JSON.stringify({
          name: { firstName: "John", lastName: "Doe" },
          email: "body@example.com",
        }),
      });

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: "John Doe",
        email: "body@example.com",
      }),
    );
  });

  it("fails closed on an unknown or replayed state", async () => {
    consumeOAuthState.mockResolvedValue(null); // already consumed
    const fetchMock = stubApple(idTokenPayload({ sub: "a1", email: "a@b.com" }));

    const res = await request(app)
      .post("/api/auth/apple/callback")
      .send({ code: "abc", state: "replayed" });

    expect(res.headers.location).toBe("https://flygaca.com/account?signin=failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed with no code", async () => {
    consumeOAuthState.mockResolvedValue("https://flygaca.com/account");
    const res = await request(app)
      .post("/api/auth/apple/callback")
      .send({ state: "s1" });
    expect(res.headers.location).toBe("https://flygaca.com/account?signin=failed");
  });

  it("fails closed when the token exchange is rejected", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    consumeOAuthState.mockResolvedValue("https://flygaca.com/account");
    stubApple("", false);

    const res = await request(app)
      .post("/api/auth/apple/callback")
      .send({ code: "abc", state: "s1" });

    expect(res.headers.location).toBe("https://flygaca.com/account?signin=failed");
    expect(createUser).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("fails closed when id_token is malformed (wrong part count)", async () => {
    consumeOAuthState.mockResolvedValue("https://flygaca.com/account");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id_token: "header.payload" }), // only 2 parts
    }));

    const res = await request(app)
      .post("/api/auth/apple/callback")
      .send({ code: "abc", state: "s1" });

    expect(res.headers.location).toBe("https://flygaca.com/account?signin=failed");
    expect(createUser).not.toHaveBeenCalled();
  });

  it("fails closed when id_token payload is not valid JSON", async () => {
    consumeOAuthState.mockResolvedValue("https://flygaca.com/account");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id_token: "header.invalid-base64.signature" }),
    }));

    const res = await request(app)
      .post("/api/auth/apple/callback")
      .send({ code: "abc", state: "s1" });

    expect(res.headers.location).toBe("https://flygaca.com/account?signin=failed");
    expect(createUser).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("fails closed when Apple returns no subject or no address", async () => {
    consumeOAuthState.mockResolvedValue("https://flygaca.com/account");
    stubApple(idTokenPayload({ sub: "", email: "a@b.com" }));
    const noSub = await request(app)
      .post("/api/auth/apple/callback")
      .send({ code: "abc", state: "s1" });
    expect(noSub.headers.location).toBe("https://flygaca.com/account?signin=failed");

    consumeOAuthState.mockResolvedValue("https://flygaca.com/account");
    stubApple(idTokenPayload({ sub: "a1" }));
    const noEmail = await request(app)
      .post("/api/auth/apple/callback")
      .send({ code: "abc", state: "s1" });
    expect(noEmail.headers.location).toBe("https://flygaca.com/account?signin=failed");
    expect(createUser).not.toHaveBeenCalled();
  });
});
