import { z } from "zod";

export const documentExtractionSchema = z.object({
  summary: z.string().default(""),
  education: z.array(z.object({
    institution: z.string(),
    degree: z.string(),
    field: z.string().optional(),
    start_year: z.number().int().optional(),
    end_year: z.number().int().optional(),
    grade: z.string().optional(),
  })).default([]),
  work_experience: z.array(z.object({
    company: z.string(),
    role: z.string(),
    start: z.string().optional(),
    end: z.string().optional(),
    is_current: z.boolean().default(false),
    responsibilities: z.array(z.string()).default([]),
    technologies: z.array(z.string()).default([]),
  })).default([]),
  projects: z.array(z.object({
    name: z.string(),
    description: z.string(),
    technologies: z.array(z.string()).default([]),
    outcomes: z.array(z.string()).default([]),
    links: z.array(z.string()).default([]),
  })).default([]),
  certifications: z.array(z.object({
    title: z.string(),
    issuer: z.string().optional(),
    issued: z.string().optional(),
    skills_covered: z.array(z.string()).default([]),
  })).default([]),
  skills: z.array(z.object({
    name: z.string(),
    category: z.enum(["programming_language", "framework_library", "database", "cloud_devops", "ai_ml", "data_analytics", "security", "testing_quality", "tools_platforms", "soft_skill", "domain_knowledge", "other"]),
    context: z.string(),
    evidence_snippet: z.string().optional(),
  })).default([]),
  contact_links: z.object({
    github: z.string().optional(),
    linkedin: z.string().optional(),
    portfolio: z.string().optional(),
  }).default({}),
  warnings: z.array(z.string()).default([]),
});
