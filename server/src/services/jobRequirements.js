import { env } from "../config/env.js";
import { runStructured } from "../ai/runStructured.js";
import { systemInstruction } from "../ai/prompts/system.js";
import { jobRequirementsSchema } from "../ai/schemas/job.js";

export async function extractJobRequirements(job) {
  if (!job.description) return jobRequirementsSchema.parse({});
  return runStructured({
    model: env.GEMINI_MODEL,
    systemInstruction: `${systemInstruction}\nExtract requirements from this job posting. Separate required from preferred skills and use null for unstated details. Do not invent requirements.`,
    parts: [{ text: `<job_posting>${job.title}\n${job.description.slice(0, 8000)}</job_posting>` }],
    schema: jobRequirementsSchema,
  });
}
