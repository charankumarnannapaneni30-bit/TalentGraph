import { z } from "zod";

const skillCategory = z.enum([
  "programming_language", "framework_library", "database", "cloud_devops", "ai_ml",
  "data_analytics", "security", "testing_quality", "tools_platforms", "soft_skill",
  "domain_knowledge", "other",
]);
const skillLevel = z.enum(["strong", "intermediate", "basic", "needs_assessment"]);
const evidenceStrength = z.enum(["strong", "moderate", "weak", "none"]);

export const profileSchema = z.object({
  summary: z.string(),
  education: z.array(z.record(z.unknown())).default([]),
  work_experience: z.array(z.record(z.unknown())).default([]),
  projects: z.array(z.object({
    name: z.string(),
    description: z.string(),
    technologies: z.array(z.string()).default([]),
    outcomes: z.array(z.string()).default([]),
    source_document_ids: z.array(z.string()).default([]),
  })).default([]),
  certifications: z.array(z.record(z.unknown())).default([]),
  specializations: z.array(z.string()).max(5).default([]),
  strengths: z.array(z.object({ title: z.string(), reason: z.string() })).max(8).default([]),
  total_experience_months: z.number().int().min(0),
  highest_education: z.string().optional(),
  skills: z.array(z.object({
    name: z.string(),
    normalized_name: z.string(),
    category: skillCategory,
    level: skillLevel,
    level_reasoning: z.string(),
    claimed: z.boolean(),
    evidence_strength: evidenceStrength,
    evidence: z.array(z.object({
      document_id: z.string().optional(),
      evidence_type: z.string(),
      description: z.string(),
      strength: evidenceStrength,
    })).default([]),
    user_confirmed: z.boolean().default(false),
  })).default([]),
  evidence_report: z.object({
    supported_skills: z.array(z.string()).default([]),
    unsupported_skills: z.array(z.object({ skill: z.string(), note: z.string() })).default([]),
    inconsistencies: z.array(z.object({
      description: z.string(),
      documents_involved: z.array(z.string()).default([]),
      severity: z.enum(["low", "medium", "high"]),
    })).default([]),
    missing_information: z.array(z.string()).default([]),
    needs_assessment: z.array(z.object({ skill: z.string(), suggested_assessment: z.string() })).default([]),
  }).default({}),
});

export const careerRecommendationsSchema = z.object({
  recommendations: z.array(z.object({
    career_title: z.string(),
    domain: z.string(),
    suitability_score: z.number().int().min(0).max(100),
    score_breakdown: z.object({
      skill_fit: z.number().int().min(0).max(100),
      project_fit: z.number().int().min(0).max(100),
      education_fit: z.number().int().min(0).max(100),
      experience_fit: z.number().int().min(0).max(100),
      growth_potential: z.number().int().min(0).max(100),
    }),
    supporting_strengths: z.array(z.string()).default([]),
    relevant_skills: z.array(z.string()).default([]),
    missing_skills: z.array(z.object({
      skill: z.string(),
      importance: z.enum(["critical", "important", "nice_to_have"]),
    })).default([]),
    career_opportunities: z.array(z.string()).default([]),
    recommended_improvements: z.array(z.string()).default([]),
    reasoning: z.string(),
    is_stretch: z.boolean().default(false),
  })).min(5).max(8),
}).superRefine(({ recommendations }, context) => {
  if (recommendations.filter((item) => item.is_stretch).length !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["recommendations"], message: "Include exactly one stretch recommendation." });
  }
});
