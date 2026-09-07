/**
 * Postgres access — the Firestore replacement.
 *
 * One `pg` pool per container. On Cloud Run point `DATABASE_URL` at the Cloud SQL
 * unix socket (`postgresql://user:pass@/db?host=/cloudsql/PROJECT:REGION:INSTANCE`)
 * so no IP allowlisting or proxy sidecar is needed.
 *
 * Everything the old code did with `runTransaction` maps onto {@link tx}, which
 * gives serializable-enough semantics via `SELECT ... FOR UPDATE` inside a single
 * connection's transaction.
 */
import pg from "pg";
import { config } from "./config.js";

// Postgres returns BIGINT/NUMERIC as strings to avoid precision loss. Every
// counter we store fits comfortably in a JS number, so parse them back.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number.parseInt(v, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number.parseFloat(v));

let pool: pg.Pool | null = null;

/** The shared connection pool, created on first use. */
export function getPool(): pg.Pool {
  if (!pool) {
    const created = new pg.Pool({
      connectionString: config.db.url,
      max: config.db.poolMax,
      ssl:
        config.db.url &&
        !config.db.url.includes("localhost") &&
        !config.db.url.includes("127.0.0.1") &&
        !config.db.url.includes("/cloudsql/")
          ? { rejectUnauthorized: false }
          : undefined,
      // Cloud Run & Vercel serverless freeze idle instances; a short idle timeout avoids handing out
      // a connection the database has already reaped.
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    // `pg` emits 'error' on the pool when an *idle* client dies — a Cloud SQL
    // failover or maintenance restart, not anything a request did. `Pool` is an
    // EventEmitter, so with no listener that emit is an uncaught exception and
    // takes the whole instance down. pg has already removed and closed the client
    // by this point, so logging is the entire correct response: the next caller
    // gets a fresh connection. Attached here rather than after the assignment
    // because `getPool` runs on every query and would otherwise stack listeners.
    created.on("error", (err) => {
      console.error("Idle Postgres client died; connection discarded:", err);
    });
    pool = created;
  }
  return pool;
}

/** Run a query and return its rows. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query<T>(text, params as unknown[]);
  return res.rows;
}

/** Run a query expected to match at most one row. */
export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Run `fn` inside a transaction, committing on resolve and rolling back on throw.
 * The callback receives the dedicated client — use it for every statement in the
 * transaction, never the pool.
 */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Liveness probe for `/healthz` — cheap and connection-validating. */
export async function ping(): Promise<boolean> {
  try {
    await query("SELECT 1");
    return true;
  } catch (err) {
    console.error("ping: database query failed:", err);
    return false;
  }
}

/** Close the pool (tests and graceful shutdown). */
export async function closePool(): Promise<void> {
  await pool?.end();
  pool = null;
}
