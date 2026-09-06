/**
 * Data access — every SQL statement the routes need, in one place.
 *
 * This is the Firestore layer's replacement. Two conventions carried over from
 * the rules-based design:
 *   - `entitlement`, `chat_credits` and `pack_entitlements` are SERVER-WRITTEN
 *     ONLY. No exported function here is reachable from a client-controlled path
 *     that would let a caller set its own plan.
 *   - Reads are scoped by `user_id` at the query level, never filtered in JS.
 */
import type { PoolClient } from "pg";
import { query, queryOne, tx } from "./db.js";
import type { Entitlement, Plan } from "./billing-core.js";

export interface UserRow {
  id: string;
  email: string;
  email_verified: boolean;
  password_hash: string | null;
  display_name: string;
  google_sub: string | null;
  created_at: Date;
}

/** The claims the gateway and routes thread through after resolving a session. */
export interface AuthedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  createdAtMs: number;
}

export function toAuthedUser(row: UserRow): AuthedUser {
  return {
    uid: row.id,
    email: row.email,
    emailVerified: row.email_verified,
    displayName: row.display_name,
    createdAtMs: row.created_at.getTime(),
  };
}

// ------------------------------------------------------------------ users --

export function findUserById(id: string): Promise<UserRow | null> {
  return queryOne<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
}

export function findUserByEmail(email: string): Promise<UserRow | null> {
  return queryOne<UserRow>("SELECT * FROM users WHERE email = $1", [email]);
}

export function findUserByGoogleSub(sub: string): Promise<UserRow | null> {
  return queryOne<UserRow>("SELECT * FROM users WHERE google_sub = $1", [sub]);
}

export function findUserByAppleSub(sub: string): Promise<UserRow | null> {
  return queryOne<UserRow>("SELECT * FROM users WHERE apple_sub = $1", [sub]);
}

export async function createUser(input: {
  email: string;
  passwordHash?: string | null;
  displayName?: string;
  googleSub?: string | null;
  appleSub?: string | null;
  emailVerified?: boolean;
}): Promise<UserRow> {
  const row = await queryOne<UserRow>(
    `INSERT INTO users (email, password_hash, display_name, google_sub, apple_sub, email_verified)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.email,
      input.passwordHash ?? null,
      input.displayName ?? "",
      input.googleSub ?? null,
      input.appleSub ?? null,
      input.emailVerified ?? false,
    ],
  );
  if (!row) throw new Error("createUser: insert returned no row");
  await query("INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [row.id]);
  return row;
}

/**
 * Link a Google subject to an existing account.
 *
 * `emailVerified` is Google's own `email_verified` assertion and only ever adds
 * verification (`OR`), never removes it. It must not be forced to `true`: a
 * verified email is the sole ownership proof behind the staff / school-seat /
 * founding grants, so an unverified assertion that flipped the flag would hand
 * an attacker both the victim's session and every email-gated entitlement.
 */
export function linkGoogleAccount(
  userId: string,
  googleSub: string,
  emailVerified: boolean,
): Promise<UserRow | null> {
  return queryOne<UserRow>(
    `UPDATE users
        SET google_sub = $2, email_verified = email_verified OR $3, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [userId, googleSub, emailVerified],
  );
}

export function linkAppleAccount(
  userId: string,
  appleSub: string,
  emailVerified: boolean,
): Promise<UserRow | null> {
  return queryOne<UserRow>(
    `UPDATE users
        SET apple_sub = $2, email_verified = email_verified OR $3, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [userId, appleSub, emailVerified],
  );
}

export async function setEmailVerified(userId: string): Promise<void> {
  await query("UPDATE users SET email_verified = true, updated_at = now() WHERE id = $1", [userId]);
}

export async function setPasswordHash(userId: string, hash: string): Promise<void> {
  await query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [
    userId,
    hash,
  ]);
}

export async function setDisplayName(userId: string, displayName: string): Promise<void> {
  await query("UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1", [
    userId,
    displayName,
  ]);
}

// ------------------------------------------------------------ auth tokens --

export async function createAuthToken(
  digest: string,
  userId: string,
  kind: "verify" | "reset",
  ttlMinutes: number,
): Promise<void> {
  await query(
    `INSERT INTO auth_tokens (digest, user_id, kind, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [digest, userId, kind, ttlMinutes],
  );
}

/**
 * Atomically consume a token: returns its user id, or `null` when the token is
 * unknown, of the wrong kind, expired, or already used. The `used_at IS NULL`
 * predicate inside the UPDATE is what makes it single-use under concurrency.
 */
export async function consumeAuthToken(
  digest: string,
  kind: "verify" | "reset",
): Promise<string | null> {
  const row = await queryOne<{ user_id: string }>(
    `UPDATE auth_tokens
        SET used_at = now()
      WHERE digest = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [digest, kind],
  );
  return row?.user_id ?? null;
}

export async function createOAuthState(state: string, returnTo: string): Promise<void> {
  await query(
    `INSERT INTO oauth_states (state, return_to, expires_at)
     VALUES ($1, $2, now() + interval '15 minutes')`,
    [state, returnTo],
  );
}

/** Single-use consumption of an OAuth state; returns the stored return URL. */
export async function consumeOAuthState(state: string): Promise<string | null> {
  const row = await queryOne<{ return_to: string }>(
    "DELETE FROM oauth_states WHERE state = $1 AND expires_at > now() RETURNING return_to",
    [state],
  );
  return row?.return_to ?? null;
}

// ---------------------------------------------------------------- account --

export interface ProfileRow {
  home_base: string;
  licence_type: string;
  medical_expiry: string;
  last_flight_review: string;
  role: string;
}

/**
 * The full account payload for `GET /api/account`, shaped to the wire contract
 * the client's `sync.ts` mappers expect (a flat user doc carrying `entitlement`).
 */
export async function loadAccount(userId: string): Promise<{
  user: Record<string, unknown>;
  logbook: Array<Record<string, unknown>>;
  records: Array<Record<string, unknown>>;
  chatCredits: number;
  ownedPacks: string[];
}> {
  const [user, profile, ent, flights, records, credits, packs] = await Promise.all([
    findUserById(userId),
    queryOne<ProfileRow>("SELECT * FROM profiles WHERE user_id = $1", [userId]),
    getEntitlement(userId),
    query<Record<string, unknown>>(
      `SELECT id, date, type, reg, "from", "to", total, pic, night, ifr, ldg,
              night_ldg AS "nightLdg", appr, remarks
         FROM flights WHERE user_id = $1 ORDER BY date DESC, id`,
      [userId],
    ),
    query<Record<string, unknown>>(
      `SELECT id, category, title, ref, issued, expires, remarks
         FROM pilot_records WHERE user_id = $1 ORDER BY expires, id`,
      [userId],
    ),
    queryOne<{ balance: number }>("SELECT balance FROM chat_credits WHERE user_id = $1", [userId]),
    query<{ pack_id: string }>("SELECT pack_id FROM pack_entitlements WHERE user_id = $1", [
      userId,
    ]),
  ]);

  return {
    user: {
      email: user?.email ?? "",
      displayName: user?.display_name ?? "",
      homeBase: profile?.home_base ?? "",
      licenceType: profile?.licence_type ?? "",
      medicalExpiry: profile?.medical_expiry ?? "",
      lastFlightReview: profile?.last_flight_review ?? "",
      role: profile?.role ?? "",
      entitlement: ent,
    },
    logbook: flights,
    records,
    chatCredits: credits?.balance ?? 0,
    ownedPacks: packs.map((p) => p.pack_id),
  };
}

/** Persist the client-writable profile fields. Never touches the entitlement. */
export async function saveProfile(
  userId: string,
  p: Record<string, string>,
): Promise<void> {
  await query(
    `INSERT INTO profiles (user_id, home_base, licence_type, medical_expiry,
                           last_flight_review, role, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (user_id) DO UPDATE SET
       home_base = EXCLUDED.home_base,
       licence_type = EXCLUDED.licence_type,
       medical_expiry = EXCLUDED.medical_expiry,
       last_flight_review = EXCLUDED.last_flight_review,
       role = EXCLUDED.role,
       updated_at = now()`,
    [
      userId,
      p.homeBase ?? "",
      p.licenceType ?? "",
      p.medicalExpiry ?? "",
      p.lastFlightReview ?? "",
      p.role ?? "",
    ],
  );
  if (typeof p.displayName === "string") await setDisplayName(userId, p.displayName);
}

const FLIGHT_COLUMNS = [
  "date",
  "type",
  "reg",
  "from",
  "to",
  "total",
  "pic",
  "night",
  "ifr",
  "ldg",
  "night_ldg",
  "appr",
  "remarks",
] as const;

/**
 * Upsert one owner-scoped row keyed by `(user_id, id)` — the shape both the logbook
 * and the pilot-records tables share.
 *
 * `table` and `columns` are module constants, never caller input, so the identifiers
 * interpolated below can't be client-controlled; every VALUE travels as a bound
 * parameter. Identifiers are always quoted because the logbook has `from` and `to`
 * columns, which are reserved words — quoting an already-lowercase name is a no-op,
 * so applying it uniformly costs nothing.
 *
 * `columnToField` maps a column name back to its wire field for the few that differ
 * (the client sends camelCase); it defaults to identity.
 */
async function upsertOwnedRow(
  table: string,
  columns: readonly string[],
  userId: string,
  id: string,
  body: Record<string, unknown>,
  columnToField: (column: string) => string = (c) => c,
): Promise<void> {
  const cols = columns.map((c) => `"${c}"`).join(", ");
  const placeholders = columns.map((_, i) => `$${i + 3}`).join(", ");
  const updates = columns.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ");
  const values = columns.map((c) => {
    const v = body[columnToField(c)];
    return typeof v === "string" ? v : "";
  });
  await query(
    `INSERT INTO ${table} (user_id, id, ${cols})
     VALUES ($1, $2, ${placeholders})
     ON CONFLICT (user_id, id) DO UPDATE SET ${updates}, updated_at = now()`,
    [userId, id, ...values],
  );
}

/** The one logbook column whose wire field name differs from its column name. */
const flightField = (column: string): string =>
  column === "night_ldg" ? "nightLdg" : column;

export function upsertFlight(
  userId: string,
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  return upsertOwnedRow("flights", FLIGHT_COLUMNS, userId, id, body, flightField);
}

export async function deleteFlight(userId: string, id: string): Promise<void> {
  await query("DELETE FROM flights WHERE user_id = $1 AND id = $2", [userId, id]);
}

const RECORD_COLUMNS = ["category", "title", "ref", "issued", "expires", "remarks"] as const;

export function upsertRecord(
  userId: string,
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  return upsertOwnedRow("pilot_records", RECORD_COLUMNS, userId, id, body);
}

export async function deleteRecord(userId: string, id: string): Promise<void> {
  await query("DELETE FROM pilot_records WHERE user_id = $1 AND id = $2", [userId, id]);
}

export async function saveStudyProgress(userId: string, summary: unknown): Promise<void> {
  await query(
    `INSERT INTO study_progress (user_id, summary, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET summary = EXCLUDED.summary, updated_at = now()`,
    [userId, JSON.stringify(summary ?? {})],
  );
}

// ----------------------------------------------------------- entitlements --

interface EntitlementRow {
  plan: Plan;
  expires_at: Date | null;
  source: Entitlement["source"] | null;
}

export async function getEntitlement(userId: string): Promise<Entitlement | null> {
  const row = await queryOne<EntitlementRow>(
    "SELECT plan, expires_at, source FROM entitlements WHERE user_id = $1",
    [userId],
  );
  if (!row) return null;
  return {
    plan: row.plan,
    ...(row.expires_at ? { expiresAt: row.expires_at.toISOString() } : {}),
    ...(row.source ? { source: row.source } : {}),
  };
}

/** SERVER-ONLY write. Every caller must be a grant/billing path, never a client body. */
export async function setEntitlement(userId: string, ent: Entitlement): Promise<void> {
  await query(
    `INSERT INTO entitlements (user_id, plan, expires_at, source, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id) DO UPDATE SET
       plan = EXCLUDED.plan,
       expires_at = EXCLUDED.expires_at,
       source = EXCLUDED.source,
       updated_at = now()`,
    [userId, ent.plan, ent.expiresAt ?? null, ent.source ?? null],
  );
}

// --------------------------------------------------------- credits & packs --

export async function getChatCredits(userId: string): Promise<number> {
  const row = await queryOne<{ balance: number }>(
    "SELECT balance FROM chat_credits WHERE user_id = $1",
    [userId],
  );
  return row?.balance ?? 0;
}

export async function addChatCredits(userId: string, delta: number): Promise<number> {
  const row = await queryOne<{ balance: number }>(
    `INSERT INTO chat_credits (user_id, balance, updated_at)
     VALUES ($1, GREATEST(0, $2), now())
     ON CONFLICT (user_id) DO UPDATE SET
       balance = GREATEST(0, chat_credits.balance + $2), updated_at = now()
     RETURNING balance`,
    [userId, delta],
  );
  return row?.balance ?? 0;
}

/**
 * Spend exactly one credit, atomically. Returns false when the balance is zero,
 * so a concurrent pair of requests can never both spend the last credit.
 */
export async function spendOneChatCredit(userId: string): Promise<boolean> {
  const row = await queryOne<{ balance: number }>(
    `UPDATE chat_credits SET balance = balance - 1, updated_at = now()
      WHERE user_id = $1 AND balance > 0
      RETURNING balance`,
    [userId],
  );
  return row !== null;
}

export async function grantPacks(userId: string, packIds: readonly string[]): Promise<void> {
  if (packIds.length === 0) return;
  await query(
    `INSERT INTO pack_entitlements (user_id, pack_id)
     SELECT $1, unnest($2::text[])
     ON CONFLICT DO NOTHING`,
    [userId, packIds],
  );
}

// ------------------------------------------------------------- chat quota --

export async function getDailyUsage(
  userKey: string,
  day: string,
): Promise<{ day: string; count: number } | null> {
  const row = await queryOne<{ count: number }>(
    "SELECT count FROM chat_usage WHERE user_key = $1 AND day = $2",
    [userKey, day],
  );
  return row ? { day, count: row.count } : null;
}

/**
 * Increment the day's counter and return the new value, clamped by `limit`.
 * Returns `null` when the limit is already reached — the increment is skipped so
 * a rejected turn never burns the allowance.
 */
export async function consumeDailyQuota(
  userKey: string,
  day: string,
  limit: number,
): Promise<number | null> {
  const row = await queryOne<{ count: number }>(
    `INSERT INTO chat_usage (user_key, day, count, updated_at)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (user_key, day) DO UPDATE SET
       count = chat_usage.count + 1, updated_at = now()
     WHERE chat_usage.count < $3
     RETURNING count`,
    [userKey, day, limit],
  );
  return row?.count ?? null;
}

// -------------------------------------------------------------- referrals --

export async function ensureReferralCode(userId: string, code: string): Promise<string> {
  const row = await queryOne<{ code: string }>(
    `INSERT INTO referral_codes (code, user_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET code = referral_codes.code
     RETURNING code`,
    [code, userId],
  );
  return row?.code ?? code;
}

export function findReferralOwner(code: string): Promise<{ user_id: string } | null> {
  return queryOne<{ user_id: string }>("SELECT user_id FROM referral_codes WHERE code = $1", [
    code,
  ]);
}

/**
 * Record a conversion against `code` for `redeemerId`. Returns false when this
 * redeemer was already rewarded, keeping the reward strictly one-time.
 */
export async function recordReferralConversion(
  code: string,
  redeemerId: string,
): Promise<boolean> {
  return tx(async (client: PoolClient) => {
    const ins = await client.query(
      `INSERT INTO referral_redemptions (redeemer_user_id, code)
       VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING code`,
      [redeemerId, code],
    );
    if (ins.rowCount === 0) return false;
    const month = new Date().toISOString().slice(0, 7);
    await client.query(
      `UPDATE referral_codes
          SET count = count + 1,
              last_used_at = now(),
              months = jsonb_set(
                months, ARRAY[$2::text],
                to_jsonb(COALESCE((months ->> $2)::int, 0) + 1), true)
        WHERE code = $1`,
      [code, month],
    );
    return true;
  });
}

// ------------------------------------------------------------------ misc --

export async function addToWaitlist(email: string, topic?: string): Promise<void> {
  await query("INSERT INTO waitlist (email, topic) VALUES ($1, $2)", [email, topic ?? null]);
}

export async function recordAnswerFeedback(input: {
  userId?: string | null;
  rating: "up" | "down";
  session?: string;
  question?: string;
  answer?: string;
}): Promise<void> {
  await query(
    `INSERT INTO answer_feedback (user_id, rating, session, question, answer)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.userId ?? null,
      input.rating,
      input.session ?? null,
      input.question ?? null,
      input.answer ?? null,
    ],
  );
}

// --------------------------------------------------------- auth audit --

/** Log an authentication event for audit trail and brute-force detection. */
export async function logAuthEvent(input: {
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
    | "oauth-apple-signin";
  result: "success" | "failed" | "blocked";
  reason?: string;
  clientIp?: string;
  userAgent?: string;
}): Promise<void> {
  await query(
    `INSERT INTO auth_events (user_id, event_type, result, reason, client_ip, user_agent)
     VALUES ($1, $2, $3, $4, $5::inet, $6)`,
    [
      input.userId ?? null,
      input.eventType,
      input.result,
      input.reason ?? null,
      input.clientIp ?? null,
      input.userAgent ?? null,
    ],
  );
}

/** Record a failed authentication attempt for brute-force detection. */
export async function recordAuthFailure(input: {
  email?: string;
  userId?: string;
  clientIp: string;
  eventType: string;
}): Promise<void> {
  await query(
    `INSERT INTO auth_failures (email, user_id, client_ip, event_type)
     VALUES ($1, $2, $3::inet, $4)`,
    [input.email ?? null, input.userId ?? null, input.clientIp, input.eventType],
  );
}

/**
 * Count recent failed login attempts for an account (within the last `windowMs`).
 * Used to decide if the account should be locked.
 */
export async function countRecentLoginFailures(
  userId: string,
  windowMs: number = 15 * 60 * 1000,
): Promise<number> {
  const rows = await query(
    `SELECT COUNT(*) as count FROM auth_failures
     WHERE user_id = $1 AND event_type = 'login' AND attempt_at > now() - $2::interval`,
    [userId, `${Math.ceil(windowMs / 1000)} seconds`],
  );
  return rows[0]?.count ?? 0;
}

/**
 * Count recent failed registration attempts from an IP (within the last `windowMs`).
 * Used to rate-limit spam registration.
 */
export async function countRecentRegistrationAttempts(
  clientIp: string,
  windowMs: number = 15 * 60 * 1000,
): Promise<number> {
  const rows = await query(
    `SELECT COUNT(*) as count FROM auth_failures
     WHERE client_ip = $1::inet AND event_type = 'register' AND attempt_at > now() - $2::interval`,
    [clientIp, `${Math.ceil(windowMs / 1000)} seconds`],
  );
  return rows[0]?.count ?? 0;
}

/** Lock an account temporarily due to too many failed login attempts. */
export async function lockAccount(userId: string, until: Date): Promise<void> {
  await query(
    `INSERT INTO account_security (user_id, locked_until)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET locked_until = EXCLUDED.locked_until`,
    [userId, until.toISOString()],
  );
}

/** Check if an account is currently locked. */
export async function isAccountLocked(userId: string): Promise<boolean> {
  const rows = await query(
    `SELECT locked_until FROM account_security WHERE user_id = $1`,
    [userId],
  );
  if (!rows.length) return false;
  const lockedUntil = rows[0].locked_until;
  return lockedUntil ? new Date(lockedUntil) > new Date() : false;
}

/** Unlock an account when the lockout period expires. */
export async function unlockAccount(userId: string): Promise<void> {
  await query(`UPDATE account_security SET locked_until = NULL WHERE user_id = $1`, [userId]);
}

/** Record the last successful login time for an account. */
export async function recordLastLogin(userId: string): Promise<void> {
  await query(
    `INSERT INTO account_security (user_id, last_login_at)
     VALUES ($1, now())
     ON CONFLICT (user_id) DO UPDATE SET last_login_at = now()`,
    [userId],
  );
}
