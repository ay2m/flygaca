import { defineConfig } from "vitest/config";

// Local config so the server tests don't inherit the app's root vitest setup.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      // `npm run test:coverage` — the CI `server` job runs this, so the ratchet
      // below gates merges (same wiring as the app's root vitest.config.ts).
      provider: "v8",
      reporter: ["text", "html"],
      // Naming `include` explicitly measures the whole backend source rather than
      // only what the tests import, so an entirely-untested module counts against
      // coverage (same posture as the app's root vitest.config.ts). `all: true`
      // used to be needed for this and was still set here; Vitest 4 removed the
      // option, so it was dead config — and invalid, which the root file's
      // typecheck catches but this package's tsconfig does not.
      include: ["src/**"],
      // Wiring and I/O edges, exercised end to end rather than by unit tests:
      // the route manifest, the pg pool, and the outbound mail transport.
      //
      // `src/routes/**` used to be excluded wholesale, which hid ~1,300 lines
      // carrying rules that live nowhere else — grants.ts and billing.ts are the
      // only writers of `entitlements`, account.ts is where owner-scoping lives,
      // and auth.ts holds the anti-enumeration posture. Every route now has a
      // spec and none is excluded; keep it that way rather than re-adding one.
      exclude: ["src/index.ts", "src/db.ts", "src/mail.ts", "src/migrations.ts", "src/dataconnect-generated/**"],
      // A ratchet, not a target: set just below the current numbers so coverage can't
      // silently regress, while today's run passes. Raise as cover grows.
      // (`npm run test:coverage` prints the live figures.)
      //
      // These were 80 across, which the suite has never actually met — the real
      // figures were 65.52 / 63.79 / 61.05 / 64.85, so `test:coverage` exited 1.
      // Nothing ran it (the repo had no CI), so the 80 was aspirational rather
      // than protective. Now that the CI `server` job runs it on every PR they
      // sit just under the live run, per the rule above — an enforced floor
      // beats an ignored target.
      //
      // 90.77 / 81.13 / 82.52 / 91.34 at the previous re-base, with every route
      // measured (routes/** was excluded wholesale at the start) and session.ts,
      // http.ts, gateway.ts and school-core.ts covered. The remaining drag is
      // store.ts (4% — all SQL, exercised against a real database rather than
      // unit-tested) and config.ts.
      //
      // 91.38 / 82.11 / 83.21 / 92.00 after the 2026-08 hardening pass
      // (csrf-core + csrfGuard, the password policy, session iss/aud tests).
      // Statements and lines ratchet up a point; branches/functions keep a
      // full-point margin rather than chasing the live figure to the decimals.
      thresholds: {
        statements: 89,
        branches: 81,
        functions: 82,
        lines: 90,
      },
    },
  },
});
