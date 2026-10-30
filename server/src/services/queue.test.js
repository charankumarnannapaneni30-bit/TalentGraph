import { describe, expect, it, vi } from "vitest";
vi.mock("../utils/logger.js", () => ({ logger: { error: vi.fn() } }));
import { enqueueWork } from "./queue.js";

describe("background work queue retries", () => {
  it("does not rerun an application error after work may have partially completed", async () => {
    const task = vi.fn().mockRejectedValue(Object.assign(new Error("AI service unavailable"), {
      status: 503,
      code: "AI_TEMPORARILY_UNAVAILABLE",
    }));

    await expect(enqueueWork(task)).rejects.toThrow("AI service unavailable");
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("retries an unclassified transient failure", async () => {
    const task = vi.fn()
      .mockRejectedValueOnce(new Error("Temporary connection failure"))
      .mockResolvedValue("complete");

    await expect(enqueueWork(task)).resolves.toBe("complete");
    expect(task).toHaveBeenCalledTimes(2);
  });
});
