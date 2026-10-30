import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const registerSchema = loginSchema.extend({
  full_name: z.string().trim().min(2).max(120),
  consent_ai_processing: z.literal(true, { error: "Consent is required before AI processing." }),
});

export const preferencesSchema = z.object({
  preferred_locations: z.array(z.string().trim().min(1).max(100)).default([]),
  open_to_remote: z.boolean().default(true),
  job_types: z.array(z.enum(["full_time", "part_time", "internship", "contract"])).default([]),
  experience_level: z.enum(["student", "fresher", "junior", "mid", "senior"]).default("fresher"),
  min_salary: z.number().nonnegative().nullable().default(null),
  target_roles: z.array(z.string().trim().min(1).max(100)).default([]),
  excluded_companies: z.array(z.string().trim().min(1).max(100)).default([]),
  notify_new_matches: z.boolean().default(true),
  notify_min_score: z.number().int().min(0).max(100).default(65),
});
