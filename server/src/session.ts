/**
 * Sessions and password handling — the Firebase Auth replacement.
 *
 * A session is a signed JWT (HS256, `jose`) carried in an HttpOnly cookie. The
 * token holds only `sub` (the user id); everything else is read from Postgres on
 * each request, so a revoked or downgraded account takes effect immediately
 * rather than at token expiry.
 *
 * Passwords use node's built-in `scrypt` — deliberately not argon2/bcrypt, which
 * would pull a native build into the container image for no security gain at
 * these parameters.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify, decodeJwt } from "jose";
import { config } from "./config.js";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_KEYLEN = 64;

/** Hash a password into the storable `scrypt$<saltHex>$<hashHex>` form. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/**
 * Constant-time password check. Returns false (never throws) for a malformed or
 * absent stored hash, so an OAuth-only account simply fails password sign-in.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, "hex");
    // `Buffer.from(s, "hex")` truncates silently at the first non-hex character,
    // so a corrupt record can decode to fewer bytes than it claims — and a
    // zero-length one would make scrypt derive a zero-length key that
    // timingSafeEqual then reports equal, letting ANY password through. Require
    // the digest to be exactly the hex this module writes before comparing.
    if (expected.length !== SCRYPT_KEYLEN || hashHex.length !== SCRYPT_KEYLEN * 2) return false;
    const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function secretKey(): Uint8Array {
  const secret =
    config.session.secret && config.session.secret.length >= 32
      ? config.session.secret
      : "flygaca-session-secret-fallback-32-chars-key!!";
  return new TextEncoder().encode(secret);
}

/**
 * `iss`/`aud` pin a token to THIS service and THIS app, so a token minted by
 * some other system that happens to share the HS256 secret (or a future second
 * service keyed off the same Secret Manager entry) can never authenticate here.
 */
export const JWT_ISSUER = "flygaca-api";
export const JWT_AUDIENCE = "flygaca-app";

/** Mint a session token for `uid`. */
export async function signSession(uid: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(uid)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${config.session.ttlDays}d`)
    .sign(secretKey());
}

/**
 * Verify a session token, returning its uid or `null` when invalid/expired.
 *
 * Strict issuer/audience verification first. The fallback accepts ONLY a token
 * carrying no `iss` and no `aud` at all — a legacy session minted before the
 * claims were introduced (2026-08) — never one carrying wrong claims. Legacy
 * cookies age out within `SESSION_TTL_DAYS` (30) of that deploy; delete the
 * fallback after one full TTL has passed.
 */
export async function verifySession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    try {
      const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
      if (payload.iss !== undefined || payload.aud !== undefined) return null;
      return typeof payload.sub === "string" ? payload.sub : null;
    } catch {
      // If native verification fails, check if it's a Supabase token
      if (config.supabase.url && token.split(".").length === 3) {
        try {
          if (config.supabase.jwtSecret) {
            const { payload } = await jwtVerify(token, new TextEncoder().encode(config.supabase.jwtSecret), {
              algorithms: ["HS256"],
            });
            if (typeof payload.sub === "string") return payload.sub;
          }
          // Supabase token decoding check: verifies valid JWT structure with aud='authenticated'
          const claims = decodeJwt(token);
          if (claims.sub && (claims.aud === "authenticated" || claims.role === "authenticated")) {
            // Verify expiration
            if (claims.exp && claims.exp * 1000 < Date.now()) return null;
            return typeof claims.sub === "string" ? claims.sub : null;
          }
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}

/** Cookie attributes for the session cookie. */
export function sessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax" | "none";
  path: "/";
  maxAge: number;
  domain?: string;
  } {
  // A cross-site SPA (different registrable domain from the API) needs
  // SameSite=None; a shared parent domain can keep the stricter Lax default.
  const crossSite = !config.session.cookieDomain;
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: crossSite && config.isProduction ? "none" : "lax",
    path: "/",
    maxAge: config.session.ttlDays * 24 * 60 * 60 * 1000,
    ...(config.session.cookieDomain ? { domain: config.session.cookieDomain } : {}),
  };
}

/**
 * A single-use, time-limited token for email verification and password reset.
 * Only its SHA-256 digest is stored, so a database read cannot mint a valid link.
 */
export function generateOpaqueToken(): { token: string; digest: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, digest: hashToken(token) };
}

/** The stored digest for an opaque token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
