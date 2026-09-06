import { describe, expect, it } from "vitest";
import {
  shouldLockAccount,
  shouldRateLimitLoginIp,
  shouldRateLimitRegistrationIp,
  accountLockedMessage,
  getClientIp,
  getUserAgent,
} from "../src/audit-core.js";

describe("audit-core policy", () => {
  it("locks account when failures exceed threshold", () => {
    const unlocked = shouldLockAccount(5);
    expect(unlocked.locked).toBe(false);
    expect(unlocked.lockUntil).toBeUndefined();

    const locked = shouldLockAccount(20);
    expect(locked.locked).toBe(true);
    expect(locked.lockUntil).toBeInstanceOf(Date);
  });

  it("checks IP rate limiting for login", () => {
    expect(shouldRateLimitLoginIp(5)).toBe(false);
    expect(shouldRateLimitLoginIp(10)).toBe(true);
  });

  it("checks IP rate limiting for registration", () => {
    expect(shouldRateLimitRegistrationIp(2)).toBe(false);
    expect(shouldRateLimitRegistrationIp(5)).toBe(true);
  });

  it("returns the standard locked message", () => {
    expect(accountLockedMessage()).toBe("auth/too-many-requests");
  });

  it("extracts client IP and user agent", () => {
    expect(getClientIp({ ip: "1.2.3.4" })).toBe("1.2.3.4");
    expect(getClientIp({ connection: { remoteAddress: "5.6.7.8" } })).toBe("5.6.7.8");
    expect(getClientIp({})).toBeUndefined();

    expect(getUserAgent({ get: (header) => (header === "user-agent" ? "TestAgent/1.0" : undefined) })).toBe(
      "TestAgent/1.0",
    );
  });
});

