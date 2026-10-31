import { describe, expect, it } from "vitest";
import { z } from "zod";
import { documentExtractionSchema } from "./document.js";
import { githubAnalysisSchema } from "./github.js";
import { jobExplanationSchema, jobRequirementsSchema, skillGapSchema } from "./job.js";
import { careerRecommendationsSchema, profileSchema } from "./profile.js";
import { interviewFeedbackSchema } from "./interview.js";

describe("AI response schemas", () => {
  it("can generate JSON schemas for every structured AI response", () => {
    for (const schema of [
      documentExtractionSchema,
      githubAnalysisSchema,
      jobExplanationSchema,
      jobRequirementsSchema,
      skillGapSchema,
      careerRecommendationsSchema,
      profileSchema,
      interviewFeedbackSchema,
    ]) {
      expect(() => z.toJSONSchema(schema, { unrepresentable: "any" })).not.toThrow();
    }
  });

  it("rejects career recommendations without a stretch path", () => {
    const result = careerRecommendationsSchema.safeParse({
      recommendations: Array.from({ length: 5 }, (_, index) => ({
        career_title: `Career ${index}`,
        domain: "Technology",
        suitability_score: 60,
        score_breakdown: { skill_fit: 60, project_fit: 60, education_fit: 60, experience_fit: 60, growth_potential: 60 },
        reasoning: "Grounded in evidence.",
      })),
    });
    expect(result.success).toBe(false);
  });

  it("requires three roadmap phases", () => {
    const result = skillGapSchema.safeParse({
      recommended_projects: [{ title: "A", objective: "B", tech_stack: [], key_features: [], closes_gaps: [] }, { title: "B", objective: "B", tech_stack: [], key_features: [], closes_gaps: [] }, { title: "C", objective: "B", tech_stack: [], key_features: [], closes_gaps: [] }],
      learning_path: [],
      roadmap: [{ phase: "Phase 1", timeframe: "0-4 weeks", goals: [], milestones: [] }],
    });
    expect(result.success).toBe(false);
  });
});
