import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  runStructured: vi.fn(),
}));

vi.mock("../config/env.js", () => ({ env: { GEMINI_MODEL: "test-model" } }));
vi.mock("../utils/supabase.js", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("../ai/runStructured.js", () => ({ runStructured: mocks.runStructured }));
vi.mock("../utils/logger.js", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

import { answerMockInterview, deleteMockInterview, finishMockInterview } from "./interviews.js";

let interview;
let interviewQuery;

beforeEach(() => {
  interview = {
    id: "interview-id",
    user_id: "user-id",
    target_role: "Frontend developer",
    interview_type: "general",
    difficulty_level: "medium",
    status: "in_progress",
    questions_asked: 1,
    question_limit: 10,
    transcript: [{ role: "interviewer", content: "Tell me about a project you enjoyed." }],
  };
  interviewQuery = null;
  mocks.runStructured.mockReset();
  mocks.from.mockImplementation((table) => {
    let update;
    let deleting = false;
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      update: vi.fn((value) => { update = value; return query; }),
      delete: vi.fn(() => { deleting = true; return query; }),
      maybeSingle: vi.fn(async () => {
        if (table === "profiles") return { data: { consent_ai_processing: true }, error: null };
        if (table === "candidate_profiles") return { data: null, error: null };
        if (deleting) return { data: { id: interview.id }, error: null };
        return { data: update ? { ...interview, ...update } : interview, error: null };
      }),
    };
    if (table === "mock_interviews") interviewQuery = query;
    return query;
  });
});

describe("answerMockInterview", () => {
  it("uses the configured model to generate the next question", async () => {
    mocks.runStructured.mockResolvedValue({ question: "What would you improve in that project?" });

    const result = await answerMockInterview("user-id", "interview-id", "I built a small application.");

    expect(mocks.runStructured).toHaveBeenCalledWith(expect.objectContaining({ model: "test-model" }));
    expect(result.questions_asked).toBe(2);
    expect(result.transcript.map((turn) => turn.role)).toEqual(["interviewer", "candidate", "interviewer"]);
  });

  it("uses the configured model to generate final feedback", async () => {
    interview.questions_asked = interview.question_limit;
    mocks.runStructured.mockResolvedValue({
      session_summary: "You completed a thoughtful practice interview with a clear project example.",
      overall_feedback: "You explained your work clearly and gave a useful concrete example.",
      strengths: ["Clear explanation", "Relevant example"],
      areas_to_improve: ["Add more detail", "Explain the outcome"],
      development_suggestions: [{ focus: "Outcome metrics", action: "Practice describing the measurable result of a project." }],
      example_tip: "Describe the measurable result of your work.",
    });

    const result = await answerMockInterview("user-id", "interview-id", "I built a small application.");

    expect(mocks.runStructured).toHaveBeenCalledWith(expect.objectContaining({ model: "test-model" }));
    expect(result.status).toBe("completed");
    expect(result.final_feedback.overall_feedback).toContain("clearly");
  });

  it("lets a user finish early and saves a summary with development suggestions", async () => {
    mocks.runStructured.mockResolvedValue({
      session_summary: "The session ended early after one answer about a small application project.",
      overall_feedback: "The response gives an initial example, but more detail would make it easier to understand your contribution.",
      strengths: ["You chose a relevant project example."],
      areas_to_improve: ["Explain your individual contribution in more detail."],
      development_suggestions: [{ focus: "Project storytelling", action: "Practice explaining the situation, your actions, and the result in order." }],
      example_tip: "Add one specific decision you made and why it helped the project.",
    });

    const result = await finishMockInterview("user-id", "interview-id");

    expect(mocks.runStructured).toHaveBeenCalledWith(expect.objectContaining({ model: "test-model" }));
    expect(result.status).toBe("completed");
    expect(result.final_feedback.development_suggestions).toHaveLength(1);
  });

  it("allows ending before an answer without inventing performance feedback", async () => {
    interview.transcript = [{ role: "interviewer", content: "Tell me about a project you enjoyed." }];
    mocks.runStructured.mockResolvedValue({
      session_summary: "The session ended before any answers were recorded, so performance could not be assessed.",
      overall_feedback: "There is not enough response content to assess interview performance yet.",
      strengths: [],
      areas_to_improve: [],
      development_suggestions: [{ focus: "Interview practice", action: "Try answering the opening question with one specific example from your experience." }],
      example_tip: "Start with a short context, then explain what you personally did.",
    });

    const result = await finishMockInterview("user-id", "interview-id");

    expect(result.status).toBe("completed");
    expect(result.final_feedback.strengths).toEqual([]);
    expect(result.transcript).toEqual(interview.transcript);
  });

  it("deletes only the requested user's mock interview", async () => {
    await expect(deleteMockInterview("user-id", "interview-id")).resolves.toEqual({ deleted: true });

    expect(interviewQuery.delete).toHaveBeenCalledOnce();
    expect(interviewQuery.eq).toHaveBeenNthCalledWith(1, "user_id", "user-id");
    expect(interviewQuery.eq).toHaveBeenNthCalledWith(2, "id", "interview-id");
  });
});
