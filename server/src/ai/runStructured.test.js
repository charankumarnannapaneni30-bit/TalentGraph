import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const providerRequest = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function GoogleGenAI() {
    this.models = { generateContent: providerRequest };
  }),
}));
vi.mock("../config/env.js", () => ({
  env: { GEMINI_API_KEY: "test-key", GEMINI_MODEL: "available-model" },
}));
vi.mock("../utils/logger.js", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
import { logger } from "../utils/logger.js";
import { getProviderErrorStatus, isTransientProviderError, providerFailure, runStructured } from "./runStructured.js";

beforeEach(() => {
  providerRequest.mockReset();
  vi.clearAllMocks();
});

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

  it("logs safe provider diagnostics when a request fails", async () => {
    providerRequest.mockRejectedValueOnce(Object.assign(new Error("private provider details"), {
      status: 400,
      code: "INVALID_ARGUMENT",
    }));

    await expect(runStructured({
      model: "test-model",
      systemInstruction: "",
      parts: [],
      schema: z.object({}),
    })).rejects.toMatchObject({ code: "AI_REQUEST_FAILED" });

    expect(logger.error).toHaveBeenCalledWith({
      model: "test-model",
      providerStatus: 400,
      providerCode: "INVALID_ARGUMENT",
      providerErrorName: "Error",
    }, "AI provider request failed");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private provider details");
  });

  it("falls back to the standard model when the configured model is unavailable", async () => {
    providerRequest
      .mockRejectedValueOnce(Object.assign(new Error("model not found"), { status: 404 }))
      .mockResolvedValueOnce({ text: JSON.stringify({ summary: "Profile summary" }) });

    await expect(runStructured({
      model: "unavailable-model",
      systemInstruction: "",
      parts: [],
      schema: z.object({ summary: z.string() }),
    })).resolves.toEqual({ summary: "Profile summary" });

    expect(providerRequest.mock.calls.map(([request]) => request.model))
      .toEqual(["unavailable-model", "available-model"]);
    expect(logger.warn).toHaveBeenCalledWith({
      model: "unavailable-model",
      fallbackModel: "available-model",
    }, "Configured AI model unavailable; retrying with the standard model");
  });
});
