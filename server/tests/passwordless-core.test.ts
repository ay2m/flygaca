import { describe, expect, it } from "vitest";
import {
  generatePasswordlessToken,
  PASSWORD_LESS_TTL_MINUTES,
  PASSWORD_LESS_MAX_PER_EMAIL_PER_DAY,
} from "../src/passwordless-core.js";

describe("passwordless-core", () => {
  it("generates a token, 6-digit code, and display format", () => {
    const { token, code, codeDisplay } = generatePasswordlessToken();

    expect(token).toHaveLength(64); // 32 bytes hex
    expect(code).toMatch(/^\d{6}$/);
    expect(codeDisplay).toBe(`${code.slice(0, 3)} ${code.slice(3, 6)}`);
  });

  it("exports expected configuration constants", () => {
    expect(PASSWORD_LESS_TTL_MINUTES).toBe(10);
    expect(PASSWORD_LESS_MAX_PER_EMAIL_PER_DAY).toBe(5);
  });
});

