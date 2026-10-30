import { describe, expect, it } from "vitest";
import {
  getInterviewDifficultyGuidance,
  INTERVIEW_AUDIO_MAX_BYTES,
  INTERVIEW_AUDIO_MAX_DURATION_MS,
  INTERVIEW_QUESTION_LIMIT,
} from "./interviewConfig.js";

describe("mock interview configuration", () => {
  it("uses ten questions and permits five-minute audio answers", () => {
    expect(INTERVIEW_QUESTION_LIMIT).toBe(10);
    expect(INTERVIEW_AUDIO_MAX_DURATION_MS).toBe(300_000);
    expect(INTERVIEW_AUDIO_MAX_BYTES).toBe(15 * 1024 * 1024);
  });

  it("sets a consistent question difficulty from the selected level", () => {
    expect(getInterviewDifficultyGuidance("easy")).toContain("beginner-friendly");
    expect(getInterviewDifficultyGuidance("medium")).toContain("intermediate");
    expect(getInterviewDifficultyGuidance("hard")).toContain("challenging, advanced");
    expect(getInterviewDifficultyGuidance("unknown")).toContain("intermediate");
  });
});
