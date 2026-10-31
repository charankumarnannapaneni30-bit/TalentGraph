import { describe, expect, it } from "vitest";
import { z } from "zod";
import { interviewFeedbackSchema, interviewQuestionSchema, interviewTranscriptSchema } from "./interview.js";

describe("mock interview schemas", () => {
  it("defines provider-compatible structured schemas", () => {
    expect(() => z.toJSONSchema(interviewQuestionSchema)).not.toThrow();
    expect(() => z.toJSONSchema(interviewTranscriptSchema)).not.toThrow();
    expect(() => z.toJSONSchema(interviewFeedbackSchema)).not.toThrow();
  });

  it("accepts transcribed answers within the storage limit", () => {
    expect(interviewTranscriptSchema.safeParse({ transcript: "I built a project using React." }).success).toBe(true);
    expect(interviewTranscriptSchema.safeParse({ transcript: "" }).success).toBe(true);
    expect(interviewTranscriptSchema.safeParse({ transcript: "x".repeat(6001) }).success).toBe(false);
  });

  it("requires a useful single question", () => {
    expect(interviewQuestionSchema.safeParse({ question: "Tell me about a project you are proud of." }).success).toBe(true);
    expect(interviewQuestionSchema.safeParse({ question: "Hi" }).success).toBe(false);
  });

  it("requires balanced, actionable practice feedback", () => {
    const feedback = {
<<<<<<< HEAD
      overall_feedback: "Your examples were clear and relevant, though more detail about your decisions would make them stronger.",
      strengths: ["You explained the project goal clearly.", "You described your individual contribution."],
      areas_to_improve: ["Add specific outcomes to your examples.", "Explain the tradeoffs behind your choices."],
      example_tip: "Try naming the result and what you learned from the experience.",
    };
    expect(interviewFeedbackSchema.safeParse(feedback).success).toBe(true);
    expect(interviewFeedbackSchema.safeParse({ ...feedback, strengths: [] }).success).toBe(false);
=======
      session_summary: "You completed two practice questions using clear project examples.",
      overall_feedback: "Your examples were clear and relevant, though more detail about your decisions would make them stronger.",
      strengths: ["You explained the project goal clearly.", "You described your individual contribution."],
      areas_to_improve: ["Add specific outcomes to your examples.", "Explain the tradeoffs behind your choices."],
      development_suggestions: [{ focus: "Outcome details", action: "Practice adding a measurable result to each project example." }],
      example_tip: "Try naming the result and what you learned from the experience.",
    };
    expect(interviewFeedbackSchema.safeParse(feedback).success).toBe(true);
    expect(interviewFeedbackSchema.safeParse({ ...feedback, strengths: [], areas_to_improve: [] }).success).toBe(true);
    expect(interviewFeedbackSchema.safeParse({ ...feedback, development_suggestions: [] }).success).toBe(false);
>>>>>>> 5a02bbd (intial commit)
  });
});
