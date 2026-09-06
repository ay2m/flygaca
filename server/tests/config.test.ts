import { describe, expect, it } from "vitest";
import { requireEnv, assertRequiredConfig } from "../src/config.js";

describe("config helpers", () => {
  it("requireEnv returns value or throws", () => {
    process.env.TEST_EXISTING = "hello";
    expect(requireEnv("TEST_EXISTING")).toBe("hello");
    expect(() => requireEnv("TEST_NON_EXISTENT_VAR")).toThrow("Missing required environment variable");
  });

  it("assertRequiredConfig validates DATABASE_URL and SESSION_SECRET", () => {
    const origDb = process.env.DATABASE_URL;
    const origSecret = process.env.SESSION_SECRET;

    delete process.env.DATABASE_URL;
    expect(() => assertRequiredConfig()).toThrow("Missing required environment variable: DATABASE_URL");

    process.env.DATABASE_URL = "postgres://localhost/test";
    delete process.env.SESSION_SECRET;
    expect(() => assertRequiredConfig()).toThrow("Missing required environment variable: SESSION_SECRET");

    process.env.SESSION_SECRET = "short";
    expect(() => assertRequiredConfig()).toThrow("SESSION_SECRET must be at least 32 characters");

    if (origDb) process.env.DATABASE_URL = origDb;
    if (origSecret) process.env.SESSION_SECRET = origSecret;
  });
});

