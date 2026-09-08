import { describe, expect, it } from "vitest";

import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth";

// Unit tests for the shared Zod schemas backing every auth form (issue #9).
// These schemas intentionally do NOT enforce a minimum password length --
// that's Supabase's own configured minimum, surfaced as a server-returned
// error (see the "Weak password" edge case) -- so there is no test here
// asserting a hardcoded minimum length.

describe("loginSchema", () => {
  it("accepts a valid email and non-empty password", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "anything",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty email", () => {
    const result = loginSchema.safeParse({ email: "", password: "x" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["email"]);
    }
  });

  it("rejects a malformed email", () => {
    const result = loginSchema.safeParse({
      email: "not-an-email",
      password: "x",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["email"]);
    }
  });

  it("rejects an empty password", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["password"]);
    }
  });
});

describe("registerSchema", () => {
  it("accepts matching passwords with a valid email", () => {
    const result = registerSchema.safeParse({
      email: "user@example.com",
      password: "secret123",
      confirmPassword: "secret123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed email", () => {
    const result = registerSchema.safeParse({
      email: "not-an-email",
      password: "secret123",
      confirmPassword: "secret123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty password", () => {
    const result = registerSchema.safeParse({
      email: "user@example.com",
      password: "",
      confirmPassword: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path[0] === "password"),
      ).toBe(true);
    }
  });

  it("rejects a password/confirm-password mismatch, flagged on confirmPassword", () => {
    const result = registerSchema.safeParse({
      email: "user@example.com",
      password: "secret123",
      confirmPassword: "different456",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) =>
            issue.path[0] === "confirmPassword" &&
            issue.message === "Passwords do not match",
        ),
      ).toBe(true);
    }
  });
});

describe("forgotPasswordSchema", () => {
  it("accepts a valid email", () => {
    expect(
      forgotPasswordSchema.safeParse({ email: "user@example.com" }).success,
    ).toBe(true);
  });

  it("rejects an empty or malformed email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "" }).success).toBe(false);
    expect(
      forgotPasswordSchema.safeParse({ email: "nope" }).success,
    ).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("accepts matching passwords", () => {
    const result = resetPasswordSchema.safeParse({
      password: "newSecret1",
      confirmPassword: "newSecret1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a password/confirm-password mismatch, flagged on confirmPassword", () => {
    const result = resetPasswordSchema.safeParse({
      password: "newSecret1",
      confirmPassword: "somethingElse",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) =>
            issue.path[0] === "confirmPassword" &&
            issue.message === "Passwords do not match",
        ),
      ).toBe(true);
    }
  });

  it("rejects empty fields", () => {
    const result = resetPasswordSchema.safeParse({
      password: "",
      confirmPassword: "",
    });
    expect(result.success).toBe(false);
  });
});
