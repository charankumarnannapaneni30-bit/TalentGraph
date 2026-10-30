import { z } from "zod";

export const jobRequirementsSchema = z.object({
  required_skills: z.array(z.string()).default([]),
  preferred_skills: z.array(z.string()).default([]),
  education_requirement: z.string().nullable().optional(),
  min_experience_months: z.number().int().min(0).default(0),
  max_experience_months: z.number().int().min(0).nullable().optional(),
  job_type: z.enum(["full_time", "part_time", "internship", "contract"]).nullable().optional(),
  is_remote: z.boolean().default(false),
  application_deadline: z.iso.date().nullable().optional(),
  eligibility_constraints: z.array(z.string()).default([]),
  salary: z.object({
    min: z.number().nonnegative().nullable().optional(),
    max: z.number().nonnegative().nullable().optional(),
    currency: z.string().nullable().optional(),
  }).default({}),
});

export const jobExplanationSchema = z.object({
  fit_label: z.enum(["excellent_fit", "strong_fit", "moderate_fit", "stretch"]),
  why_recommended: z.string(),
  aligned_strengths: z.array(z.object({ skill: z.string(), note: z.string() })).default([]),
  gaps: z.array(z.object({ skill: z.string(), note: z.string() })).default([]),
  eligibility_notes: z.array(z.string()).default([]),
  next_actions: z.array(z.string()).min(1).max(3),
});

export const skillGapSchema = z.object({
  missing_skills: z.array(z.object({ skill: z.string(), importance: z.enum(["critical", "important", "nice_to_have"]), why: z.string() })).default([]),
  skills_to_improve: z.array(z.object({ skill: z.string(), current_level: z.string(), target_level: z.string(), how: z.string() })).default([]),
  technologies_to_learn: z.array(z.object({ technology: z.string(), priority: z.number().int().min(1).max(10), reason: z.string() })).default([]),
  recommended_projects: z.array(z.object({
    title: z.string(),
    objective: z.string(),
    tech_stack: z.array(z.string()),
    key_features: z.array(z.string()),
    closes_gaps: z.array(z.string()),
  })).min(3).max(5),
  learning_path: z.array(z.object({ order: z.number().int().positive(), topic: z.string(), resource_type: z.string(), outcome: z.string() })),
  roadmap: z.array(z.object({
    phase: z.string(),
    timeframe: z.string(),
    goals: z.array(z.string()),
    milestones: z.array(z.string()),
  })).length(3),
}).superRefine(({ roadmap }, context) => {
  const expected = ["0-4 weeks", "1-3 months", "3-6 months"];
  if (roadmap.some((phase, index) => phase.timeframe !== expected[index])) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["roadmap"], message: "Roadmap timeframes must be 0-4 weeks, 1-3 months, and 3-6 months." });
  }
});
