import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { supabaseAdmin } from "../utils/supabase.js";
import { AppError } from "../utils/errors.js";
import { runStructured } from "../ai/runStructured.js";
import { systemInstruction } from "../ai/prompts/system.js";
import { jobRequirementsSchema } from "../ai/schemas/job.js";
import { logger } from "../utils/logger.js";
import { refreshMatchesForUser } from "./profileBuilder.js";
import { sendJobMatchNotificationEmail } from "./notificationEmails.js";

const greenhouseJobSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string(),
  absolute_url: z.string().url(),
  content: z.string().nullable().optional(),
  location: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
}).passthrough();
const leverJobSchema = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string().url(),
  descriptionPlain: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  categories: z.object({
    location: z.string().nullable().optional(),
    commitment: z.string().nullable().optional(),
    team: z.string().nullable().optional(),
  }).nullable().optional(),
  workplaceType: z.string().optional(),
}).passthrough();
const sourceSchema = z.object({
  adapter: z.enum(["greenhouse", "lever", "manual"]),
  company_name: z.string().trim().min(1).max(200),
  board_token: z.string().trim().min(1).max(200).nullable().optional(),
});

function stripHtml(value) {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim().slice(0, 8000);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": env.JOB_SYNC_USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new AppError(502, "JOB_SOURCE_FAILED", `Job source returned HTTP ${response.status}.`);
  return response.json();
}

async function fetchGreenhouse(source) {
  const token = source.board_token;
  if (!token || !/^[a-zA-Z0-9_-]+$/.test(token)) throw new AppError(422, "INVALID_JOB_SOURCE", "Greenhouse board token is invalid.");
  const payload = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`);
  if (!Array.isArray(payload?.jobs)) throw new AppError(502, "JOB_SOURCE_FAILED", "Greenhouse returned an unexpected response.");
  let skipped = 0;
  const postings = payload.jobs.flatMap((item) => {
    const parsed = greenhouseJobSchema.safeParse(item);
    if (!parsed.success) { skipped += 1; return []; }
    return [{
      external_id: String(parsed.data.id),
      title: parsed.data.title,
      description: stripHtml(parsed.data.content || ""),
      location: parsed.data.location?.name || null,
      is_remote: /\bremote\b/i.test(`${parsed.data.title} ${parsed.data.location?.name || ""}`),
      official_apply_url: parsed.data.absolute_url,
    }];
  });
  return { postings, skipped };
}

async function fetchLever(source) {
  const company = source.board_token;
  if (!company || !/^[a-zA-Z0-9_-]+$/.test(company)) throw new AppError(422, "INVALID_JOB_SOURCE", "Lever company slug is invalid.");
  const payload = await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`);
  if (!Array.isArray(payload)) throw new AppError(502, "JOB_SOURCE_FAILED", "Lever returned an unexpected response.");
  let skipped = 0;
  const postings = payload.flatMap((item) => {
    const parsed = leverJobSchema.safeParse(item);
    if (!parsed.success) { skipped += 1; return []; }
    return [{
      external_id: parsed.data.id,
      title: parsed.data.text,
      description: stripHtml(parsed.data.descriptionPlain || parsed.data.description || ""),
      location: parsed.data.categories?.location || null,
      is_remote: /remote/i.test(`${parsed.data.workplaceType || ""} ${parsed.data.categories?.location || ""}`),
      job_type: parsed.data.categories?.commitment?.toLowerCase().includes("intern") ? "internship" : null,
      official_apply_url: parsed.data.hostedUrl,
    }];
  });
  return { postings, skipped };
}

async function extractRequirements(job) {
  if (!job.description) return jobRequirementsSchema.parse({});
  return runStructured({
    model: env.GEMINI_MODEL,
    systemInstruction: `${systemInstruction}\nExtract requirements from the job posting. Separate required from preferred skills and use null for unstated details.`,
    parts: [{ text: `<job_posting>${job.title}\n${job.description.slice(0, 8000)}</job_posting>` }],
    schema: jobRequirementsSchema,
  });
}

export async function syncJobSource(source) {
  if (source.adapter === "manual") return { synced: 0, skipped: 0 };
  const { postings, skipped: invalidItems } = source.adapter === "greenhouse" ? await fetchGreenhouse(source) : await fetchLever(source);
  const { data: existingRows, error: existingError } = await supabaseAdmin.from("jobs")
    .select("id, external_id, status, required_skills, preferred_skills, education_requirement, min_experience_months, max_experience_months, job_type, is_remote, salary_min, salary_max, salary_currency, eligibility_constraints, requirements_extracted")
    .eq("source_id", source.id);
  if (existingError) throw new AppError(500, "DATABASE_ERROR", "Could not load existing source jobs.");
  const existingById = new Map((existingRows || []).map((row) => [row.external_id, row]));
  let skipped = invalidItems;
  const seen = [];
  const reopened = [];
  for (const posting of postings) {
    try {
      if (!posting.title || !posting.official_apply_url) { skipped += 1; continue; }
      const current = existingById.get(posting.external_id);
      const requirements = current?.requirements_extracted
        ? {
          ...current,
          salary: {
            min: current.salary_min,
            max: current.salary_max,
            currency: current.salary_currency,
          },
        }
        : await extractRequirements(posting);
      const record = {
        source_id: source.id,
        source: source.adapter,
        external_id: posting.external_id,
        company_name: source.company_name,
        title: posting.title.slice(0, 200),
        description: posting.description,
        required_skills: requirements.required_skills || [],
        preferred_skills: requirements.preferred_skills || [],
        education_requirement: requirements.education_requirement || null,
        min_experience_months: requirements.min_experience_months || 0,
        max_experience_months: requirements.max_experience_months ?? null,
        job_type: posting.job_type || requirements.job_type || null,
        location: posting.location,
        is_remote: posting.is_remote || requirements.is_remote,
        salary_min: requirements.salary.min ?? null,
        salary_max: requirements.salary.max ?? null,
        salary_currency: requirements.salary.currency || null,
        eligibility_constraints: requirements.eligibility_constraints,
        application_deadline: requirements.application_deadline || null,
        status: "open",
        official_apply_url: posting.official_apply_url,
        requirements_extracted: true,
        last_seen_at: new Date().toISOString(),
      };
      const { data, error } = await supabaseAdmin.from("jobs").upsert(record, { onConflict: "source,external_id" }).select("id").single();
      if (error) throw error;
      seen.push(data.id);
      if (current && current.status !== "open") reopened.push(data.id);
    } catch (error) {
      skipped += 1;
      logger.warn({ sourceId: source.id, externalId: posting.external_id, code: error.code || "INVALID_JOB" }, "Skipped invalid job record");
    }
  }
  if (skipped === 0) {
    const staleQuery = supabaseAdmin.from("jobs").update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("source_id", source.id).eq("status", "open").lt("last_seen_at", new Date().toISOString());
    if (seen.length) staleQuery.not("id", "in", `(${seen.join(",")})`);
    const { error: closeError } = await staleQuery;
    if (closeError) throw new AppError(500, "DATABASE_ERROR", "Could not close jobs no longer present on this board.");
  } else {
    logger.warn({ sourceId: source.id, skipped }, "Kept existing jobs open because sync data contained invalid records");
  }
  const { error: updateError } = await supabaseAdmin.from("job_sources").update({ last_synced_at: new Date().toISOString(), last_error: null }).eq("id", source.id);
  if (updateError) throw new AppError(500, "DATABASE_ERROR", "Could not update job source sync status.");
  return { synced: seen.length, skipped, reopened };
}

export async function syncActiveSources() {
  const { data: sources, error } = await supabaseAdmin.from("job_sources").select("*").eq("is_active", true).neq("adapter", "manual");
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load active job sources.");
  const results = [];
  const reopenedJobIds = new Set();
  for (const source of sources || []) {
    try {
      const sourceResult = await syncJobSource(source);
      results.push({ source_id: source.id, ...sourceResult });
      logger.info({ sourceId: source.id, synced: sourceResult.synced, skipped: sourceResult.skipped }, "Job source sync completed");
      for (const jobId of sourceResult.reopened) reopenedJobIds.add(jobId);
    } catch (error) {
      logger.error({ sourceId: source.id, code: error.code || "SYNC_FAILED" }, "Job source sync failed");
      await supabaseAdmin.from("job_sources").update({ last_error: "Sync failed. Check source configuration and try again." }).eq("id", source.id);
      results.push({ source_id: source.id, error: "Sync failed" });
    }
  }
  const { data: profiles, error: profileError } = await supabaseAdmin.from("candidate_profiles").select("user_id").eq("is_current", true);
  if (profileError) throw new AppError(500, "DATABASE_ERROR", "Could not load profiles for job matching.");
  for (const profile of profiles || []) {
    try {
      await refreshMatchesForUser(profile.user_id);
    } catch (error) {
      logger.warn({ code: error.code || "MATCH_REFRESH_FAILED" }, "Job match refresh failed");
    }
  }
  for (const jobId of reopenedJobIds) {
    const { data: matches, error: matchError } = await supabaseAdmin.from("job_matches")
      .select("user_id, compatibility_score").eq("job_id", jobId);
    if (matchError) {
      logger.warn({ jobId, code: matchError.code }, "Could not load matches for reopened vacancy");
      continue;
    }
    const eligible = (matches || []).filter((match) => match.compatibility_score >= 40);
    if (!eligible.length) continue;
    const userIds = eligible.map((match) => match.user_id);
    const { data: preferences, error: preferencesError } = await supabaseAdmin.from("preferences")
      .select("user_id, notify_new_matches, notify_min_score").in("user_id", userIds);
    if (preferencesError) {
      logger.warn({ jobId, code: preferencesError.code }, "Could not load notification preferences for reopened vacancy");
      continue;
    }
    const byUser = new Map((preferences || []).map((preference) => [preference.user_id, preference]));
    const notifications = eligible.filter((match) => {
      const preference = byUser.get(match.user_id);
      return preference?.notify_new_matches && match.compatibility_score >= (preference.notify_min_score ?? 65);
    }).map((match) => ({
      user_id: match.user_id,
      type: "job_reopened",
      title: "A matched job has reopened",
      body: "A previously closed vacancy is open again.",
      job_id: jobId,
    }));
    if (notifications.length) {
      const { error: notificationError } = await supabaseAdmin.from("notifications").insert(notifications);
      if (notificationError) {
        logger.warn({ jobId, code: notificationError.code }, "Could not save reopened-job notification");
      } else {
        const byUser = new Map();
        for (const notification of notifications) {
          const userNotifications = byUser.get(notification.user_id) || [];
          userNotifications.push(notification);
          byUser.set(notification.user_id, userNotifications);
        }
        await Promise.all([...byUser].map(([userId, userNotifications]) => (
          sendJobMatchNotificationEmail(userId, userNotifications)
        )));
      }
    }
  }
  return results;
}

export async function createJobSource(input) {
  const parsed = sourceSchema.safeParse(input);
  if (!parsed.success) throw parsed.error;
  if (parsed.data.adapter === "manual" && parsed.data.board_token) {
    throw new AppError(422, "INVALID_JOB_SOURCE", "Manual job sources do not use a board token.");
  }
  if (parsed.data.adapter !== "manual" && !parsed.data.board_token) {
    throw new AppError(422, "INVALID_JOB_SOURCE", "A board token or company slug is required.");
  }
  const { data, error } = await supabaseAdmin.from("job_sources").insert(parsed.data).select("*").single();
  if (error) throw new AppError(422, "JOB_SOURCE_CREATE_FAILED", "This job source could not be added.");
  return data;
}

export async function createManualJob(input) {
  const schema = z.object({
    company_name: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(8000).optional().default(""),
    required_skills: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
    preferred_skills: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
    education_requirement: z.string().trim().max(200).nullable().optional(),
    min_experience_months: z.number().int().min(0).default(0),
    max_experience_months: z.number().int().min(0).nullable().optional(),
    job_type: z.enum(["full_time", "part_time", "internship", "contract"]).nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
    is_remote: z.boolean().default(false),
    salary_min: z.number().nonnegative().nullable().optional(),
    salary_max: z.number().nonnegative().nullable().optional(),
    salary_currency: z.string().trim().length(3).nullable().optional(),
    eligibility_constraints: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
    application_deadline: z.iso.date().nullable().optional(),
    official_apply_url: z.string().url().refine((value) => value.startsWith("https://"), "Apply URL must use HTTPS."),
  }).strict().superRefine((job, context) => {
    if (job.max_experience_months != null && job.max_experience_months < job.min_experience_months) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["max_experience_months"], message: "Maximum experience cannot be less than minimum experience." });
    }
    if (job.salary_min != null && job.salary_max != null && job.salary_max < job.salary_min) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["salary_max"], message: "Maximum salary cannot be less than minimum salary." });
    }
  });
  const parsed = schema.parse(input);
  const { data: source } = await supabaseAdmin.from("job_sources").select("id").eq("adapter", "manual").eq("company_name", parsed.company_name).maybeSingle();
  let sourceId = source?.id;
  if (!sourceId) {
    const { data: newSource, error: sourceError } = await supabaseAdmin.from("job_sources").insert({ adapter: "manual", company_name: parsed.company_name }).select("id").single();
    if (sourceError) throw new AppError(500, "DATABASE_ERROR", "Could not create the manual job source.");
    sourceId = newSource.id;
  }
  const { data, error } = await supabaseAdmin.from("jobs").insert({
    ...parsed,
    source_id: sourceId,
    source: "manual",
    external_id: randomUUID(),
    status: parsed.application_deadline && parsed.application_deadline < new Date().toISOString().slice(0, 10) ? "expired" : "open",
    official_apply_url: parsed.official_apply_url,
    requirements_extracted: true,
  }).select("*").single();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not save this manual job.");
  const { data: profiles, error: profilesError } = await supabaseAdmin.from("candidate_profiles").select("user_id").eq("is_current", true);
  if (profilesError) throw new AppError(500, "DATABASE_ERROR", "The manual job was saved, but matching could not be refreshed.");
  for (const profile of profiles || []) {
    try {
      await refreshMatchesForUser(profile.user_id);
    } catch (refreshError) {
      logger.warn({ code: refreshError.code || "MATCH_REFRESH_FAILED" }, "Manual job match refresh failed");
    }
  }
  return data;
}
