import { describe, expect, it, vi } from "vitest";
vi.mock("../config/env.js", () => ({ env: { GEMINI_API_KEY: "test-key" } }));
import { getProviderErrorStatus, isTransientProviderError, providerFailure } from "./runStructured.js";

describe("AI provider error handling", () => {
  it("recognizes transient provider statuses across SDK error shapes", () => {
    expect(getProviderErrorStatus({ response: { status: 429 } })).toBe(429);
    expect(isTransientProviderError({ error: { status: 503 } })).toBe(true);
    expect(isTransientProviderError({ code: "ETIMEDOUT" })).toBe(true);
    expect(isTransientProviderError({ status: 400 })).toBe(false);
  });

  it("maps provider configuration failures to safe, actionable messages", () => {
    const failure = providerFailure({ status: 403, message: "private SDK details" });
    expect(failure.status).toBe(503);
    expect(failure.code).toBe("AI_CONFIGURATION_ERROR");
    expect(failure.message).toContain("contact the app administrator");
    expect(failure.message).not.toContain("private SDK details");
  });

  it("explains rate limits without exposing provider response details", () => {
    const failure = providerFailure({ status: 429, message: "private SDK details" });
    expect(failure.code).toBe("AI_RATE_LIMITED");
    expect(failure.message).toContain("usage limit");
    expect(failure.message).not.toContain("private SDK details");
  });
});
