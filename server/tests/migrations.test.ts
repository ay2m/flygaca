import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../src/migrations.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/**
 * `server/src/migrations.ts` is a second, serverless-friendly copy of the
 * canonical `server/migrations/*.sql` files (see the comment on `MIGRATIONS`
 * for why it exists as a copy rather than a filesystem read). A `.sql` file
 * added without a matching entry here is invisible to the `/api/migrate`
 * endpoint — the only migration path available to a deploy that has no shell
 * access to the database — so its tables never get created and every route
 * that touches them 500s. This test is the tripwire for that drift.
 */
describe("runtime migrations mirror server/migrations/*.sql", () => {
  it("has one entry per canonical migration file, and no extra ones", async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    const arrayNames = MIGRATIONS.map((m) => m.name).sort();
    expect(arrayNames).toEqual(files);
  });

  it("creates every table the canonical file creates", async () => {
    const files = await readdir(MIGRATIONS_DIR);
    for (const migration of MIGRATIONS) {
      if (!files.includes(migration.name)) continue; // reported by the test above
      const fileSql = await readFile(join(MIGRATIONS_DIR, migration.name), "utf8");
      const tablesInFile = [...fileSql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? (\w+)/g)].map(
        (m) => m[1],
      );
      for (const table of tablesInFile) {
        expect(migration.sql).toContain(table);
      }
    }
  });
});
