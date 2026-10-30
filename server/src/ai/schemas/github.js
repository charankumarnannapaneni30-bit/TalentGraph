import { z } from "zod";

export const githubAnalysisSchema = z.object({
  overall_summary: z.string(),
  repositories: z.array(z.object({
    name: z.string(),
    summary: z.string(),
    technologies: z.array(z.string()).default([]),
    depth: z.enum(["trivial", "small", "moderate", "substantial"]),
    practices: z.array(z.string()).default([]),
  })).default([]),
  skills: z.array(z.object({
    name: z.string(),
    category: z.enum(["programming_language", "framework_library", "database", "cloud_devops", "ai_ml", "data_analytics", "security", "testing_quality", "tools_platforms", "soft_skill", "domain_knowledge", "other"]),
    evidence: z.string(),
  })).default([]),
  warnings: z.array(z.string()).default([]),
});
