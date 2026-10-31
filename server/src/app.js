import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "./config/env.js";
import { supabaseAdmin } from "./utils/supabase.js";
import { AppError } from "./utils/errors.js";
import { logger } from "./utils/logger.js";
import { requireAuth, requireAdmin, requireRecruiter, requireCandidate, requireConsent } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { validate } from "./middleware/validate.js";
import { createDocument, removeDocument } from "./services/documents.js";
import { buildProfile } from "./services/profileBuilder.js";
import { enqueueWork } from "./services/queue.js";
import { refreshCareerRecommendations, refreshMatchesForUser } from "./services/profileBuilder.js";
import { createJobSource, createManualJob, syncActiveSources } from "./services/jobs.js";
import { matchJob } from "./services/matching.js";
import { jobExplanationSchema, skillGapSchema } from "./ai/schemas/job.js";
import { runStructured } from "./ai/runStructured.js";
import { systemInstruction } from "./ai/prompts/system.js";
import { DISCLAIMER } from "./config/advisory.js";
import { isAllowedClientOrigin } from "./utils/corsOrigin.js";
import { answerMockInterview, deleteMockInterview, finishMockInterview, getMockInterview, listMockInterviews, startMockInterview, transcribeInterviewAudio } from "./services/interviews.js";
import { INTERVIEW_AUDIO_MAX_BYTES } from "./services/interviewConfig.js";
import { searchCandidates, getCandidateDetail, sendRecruiterInquiry, listRecruiterInquiries, listCandidateInquiries, respondToInquiry } from "./services/recruiter.js";
import { revokeRecruiterAccess } from "./services/adminRecruiters.js";
import {
  addRecruiterShortlist, applyToRecruiterJob, createRecruiterJob, listCandidateApplications,
  listOpenRecruiterJobs, listRecruiterApplications, listRecruiterInterviews, listRecruiterJobs,
  listRecruiterShortlist, removeRecruiterShortlist, scheduleRecruiterInterview,
  updateRecruiterApplication, updateRecruiterInterview, updateRecruiterJob,
} from "./services/recruiterJobs.js";

const app = express();
app.set("trust proxy", 1);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.max(env.MAX_PDF_MB, env.MAX_IMAGE_MB) * 1024 * 1024, files: 1 },
});
const interviewAudioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: INTERVIEW_AUDIO_MAX_BYTES, files: 1 },
});
const interviewAudioTypes = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/mpeg"]);
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const send = (res, data, status = 200, extra = {}) => res.status(status).json({ data, ...extra });
const userRateLimit = (windowMs, limit) => rateLimit({
  windowMs,
  limit,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: { error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." } },
});
const aiRateLimit = userRateLimit(15 * 60 * 1000, 20);
const uploadRateLimit = userRateLimit(60 * 60 * 1000, 30);
const emptyBodySchema = z.object({}).strict();
const uuidParam = (field) => (req, _res, next) => {
  const parsed = z.string().uuid().safeParse(req.params[field]);
  return parsed.success ? next() : next(parsed.error);
};

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => callback(null, isAllowedClientOrigin(origin, env.CLIENT_ORIGIN, env.NODE_ENV)),
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false }));

app.get("/api/v1/health", (_req, res) => send(res, { status: "ok" }));

const router = express.Router();
router.use(requireAuth);
router.use((req, res, next) => {
  const sharedPaths = ["/me", "/account", "/notifications"];
  if (req.path.startsWith("/recruiter/") || req.path.startsWith("/admin/")
    || sharedPaths.some((path) => req.path === path || req.path.startsWith(`${path}/`))) {
    return next();
  }
  return requireCandidate(req, res, next);
});

router.get("/me", asyncRoute(async (req, res) => {
  const { data: profile, error: profileError } = await supabaseAdmin.from("profiles")
    .select("id, full_name, company_name, consent_ai_processing, consent_at, created_at").eq("id", req.user.id).maybeSingle();
  if (profileError) throw new AppError(500, "DATABASE_ERROR", "Could not load your profile.");
  const { data: preferences, error: preferenceError } = await supabaseAdmin.from("preferences")
    .select("*").eq("user_id", req.user.id).maybeSingle();
  if (preferenceError) throw new AppError(500, "DATABASE_ERROR", "Could not load your preferences.");
  const { data: recruiterAccessRequest, error: accessRequestError } = await supabaseAdmin.from("recruiter_access_requests")
    .select("company_name, status, created_at").eq("user_id", req.user.id).maybeSingle();
  if (accessRequestError) throw new AppError(500, "DATABASE_ERROR", "Could not load your recruiter access status.");

  const role = req.user.app_metadata?.role || "candidate";

  return send(res, {
    ...profile,
    role,
    recruiter_access_request: recruiterAccessRequest || null,
    user: { user_metadata: req.user.user_metadata, app_metadata: req.user.app_metadata },
    preferences: preferences || {},
  });
}));

const meSchema = z.object({
  full_name: z.string().trim().min(2).max(120).optional(),
  consent_ai_processing: z.boolean().optional(),
}).strict();
router.patch("/me", validate(meSchema), asyncRoute(async (req, res) => {
  const update = { updated_at: new Date().toISOString() };
  if (req.body.full_name !== undefined) update.full_name = req.body.full_name;
  if (req.body.consent_ai_processing !== undefined) {
    update.consent_ai_processing = req.body.consent_ai_processing;
    update.consent_at = req.body.consent_ai_processing ? new Date().toISOString() : null;
  }

  let savedData = { id: req.user.id, full_name: req.body.full_name || req.user.user_metadata?.full_name };
  try {
    const { data, error } = await supabaseAdmin.from("profiles").update(update).eq("id", req.user.id).select("id, full_name, company_name, consent_ai_processing, consent_at").single();
    if (!error && data) savedData = data;
  } catch (err) {
    logger.warn({ err }, "Could not update some fields in profiles table");
  }

  const updatedMetadata = { ...req.user.user_metadata };
  if (req.body.full_name !== undefined) updatedMetadata.full_name = req.body.full_name;

  const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
    user_metadata: updatedMetadata,
  });
  if (metadataError) throw new AppError(500, "PROFILE_METADATA_UPDATE_FAILED", "Profile updated but account metadata could not be updated.");

  return send(res, {
    ...savedData,
    role: req.user.app_metadata?.role || "candidate",
  });
}));

const preferenceSchema = z.object({
  preferred_locations: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  open_to_remote: z.boolean().optional(),
  job_types: z.array(z.enum(["full_time", "part_time", "internship", "contract"])).max(4).optional(),
  experience_level: z.enum(["student", "fresher", "junior", "mid", "senior"]).optional(),
  min_salary: z.number().nonnegative().nullable().optional(),
  target_roles: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  excluded_companies: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  notify_new_matches: z.boolean().optional(),
  notify_min_score: z.number().int().min(0).max(100).optional(),
}).strict();
router.get("/preferences", asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("preferences").select("*").eq("user_id", req.user.id).maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load preferences.");
  return send(res, data || {});
}));
router.put("/preferences", validate(preferenceSchema), asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("preferences").upsert({ user_id: req.user.id, ...req.body, updated_at: new Date().toISOString() }).select("*").single();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not save preferences.");
  enqueueWork(() => refreshMatchesForUser(req.user.id), { task: "preference_match_refresh" }).catch((failure) => {
    logger.error({ code: failure.code || "MATCH_REFRESH_FAILED" }, "Preference match refresh failed");
  });
  return send(res, data);
}));

const interviewStartSchema = z.object({
  target_role: z.string().trim().min(2).max(120),
  interview_type: z.enum(["general", "behavioral", "technical"]),
  difficulty_level: z.enum(["easy", "medium", "hard"]),
}).strict();
router.get("/interviews", asyncRoute(async (req, res) => {
  return send(res, await listMockInterviews(req.user.id));
}));
router.post("/interviews", aiRateLimit, requireConsent, validate(interviewStartSchema), asyncRoute(async (req, res) => {
  return send(res, await startMockInterview(req.user.id, req.body), 201);
}));
router.get("/interviews/:id", uuidParam("id"), asyncRoute(async (req, res) => {
  return send(res, await getMockInterview(req.user.id, req.params.id));
}));
router.delete("/interviews/:id", uuidParam("id"), asyncRoute(async (req, res) => {
  return send(res, await deleteMockInterview(req.user.id, req.params.id));
}));
router.post("/interviews/:id/answers", uuidParam("id"), aiRateLimit, requireConsent, validate(z.object({
  answer: z.string().trim().min(1).max(6000),
}).strict()), asyncRoute(async (req, res) => {
  return send(res, await answerMockInterview(req.user.id, req.params.id, req.body.answer));
}));
router.post("/interviews/:id/finish", uuidParam("id"), aiRateLimit, requireConsent, validate(emptyBodySchema), asyncRoute(async (req, res) => {
  return send(res, await finishMockInterview(req.user.id, req.params.id));
}));
router.post("/interviews/:id/transcribe", uuidParam("id"), aiRateLimit, requireConsent, interviewAudioUpload.single("audio"), asyncRoute(async (req, res) => {
  if (!req.file) throw new AppError(422, "AUDIO_REQUIRED", "Record an answer before requesting transcription.");
  const mimeType = req.file.mimetype.split(";")[0].trim().toLowerCase();
  if (!interviewAudioTypes.has(mimeType)) throw new AppError(422, "INVALID_AUDIO_TYPE", "Use a supported browser audio recording.");
  if (req.file.size === 0) throw new AppError(422, "EMPTY_AUDIO", "The audio recording was empty. Try speaking again.");
  return send(res, await transcribeInterviewAudio(req.user.id, req.params.id, { buffer: req.file.buffer, mimeType }));
}));
const documentType = z.enum(["resume", "certificate", "education_record", "project_report", "project_screenshot", "text_note", "github_profile", "portfolio_link"]);
const githubUrlPattern = /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}(\/[\w.-]+)?\/?$/;
const documentBodySchema = z.object({
  doc_type: documentType,
  title: z.string().trim().max(200).optional(),
  text: z.string().max(20_000).optional(),
  url: z.string().url().refine((value) => value.startsWith("https://"), "URL must use HTTPS.").optional(),
}).strict();
router.get("/documents", asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("documents").select("id, doc_type, title, original_filename, mime_type, size_bytes, status, error_message, extracted, created_at, processed_at").eq("user_id", req.user.id).order("created_at", { ascending: false });
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load your documents.");
  return send(res, data || []);
}));
router.post("/documents", uploadRateLimit, requireConsent, upload.single("file"), asyncRoute(async (req, res) => {
  const parsed = documentBodySchema.safeParse(req.body);
  if (!parsed.success) throw parsed.error;
  const { doc_type: docType, title, text, url } = parsed.data;
  const file = req.file;
  if (docType === "github_profile" && (!url || !githubUrlPattern.test(url))) {
    throw new AppError(422, "INVALID_GITHUB_URL", "Use a public GitHub profile or repository URL.");
  }
  if (docType === "text_note" && (!text || file || url)) throw new AppError(422, "INPUT_REQUIRED", "Text notes require text only.");
  if ((docType === "github_profile" || docType === "portfolio_link") && (!url || file || text)) {
    throw new AppError(422, "INPUT_REQUIRED", "Provide only the required HTTPS link for this evidence type.");
  }
  if (!["text_note", "github_profile", "portfolio_link"].includes(docType) && (!file || text || url)) {
    throw new AppError(422, "INPUT_REQUIRED", "Provide one PDF or image file for this evidence type.");
  }
  const document = await createDocument({ userId: req.user.id, docType, title, file, text, sourceUrl: url });
  return send(res, document, 202);
}));
router.get("/documents/:id", uuidParam("id"), asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("documents").select("id, doc_type, title, original_filename, mime_type, size_bytes, status, error_message, extracted, created_at, processed_at").eq("user_id", req.user.id).eq("id", req.params.id).maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load the document.");
  if (!data) throw new AppError(404, "NOT_FOUND", "Document not found.");
  return send(res, data);
}));
router.post("/documents/:id/retry", uuidParam("id"), validate(emptyBodySchema), requireConsent, asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("documents").select("id, doc_type, title, storage_path, mime_type, raw_text, source_url, status").eq("user_id", req.user.id).eq("id", req.params.id).maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load the document.");
  if (!data) throw new AppError(404, "NOT_FOUND", "Document not found.");
  if (data.status !== "failed") throw new AppError(409, "INVALID_STATUS", "Only failed documents can be retried.");
  let buffer = null;
  if (data.storage_path) {
    const result = await supabaseAdmin.storage.from(env.SUPABASE_STORAGE_BUCKET).download(data.storage_path);
    if (result.error) throw new AppError(502, "STORAGE_ERROR", "The document file could not be retrieved for retry.");
    buffer = Buffer.from(await result.data.arrayBuffer());
  }
  const { data: claimed, error: claimError } = await supabaseAdmin.from("documents")
    .update({ status: "uploaded", error_message: null })
    .eq("user_id", req.user.id).eq("id", req.params.id).eq("status", "failed")
    .select("id").maybeSingle();
  if (claimError) throw new AppError(500, "DATABASE_ERROR", "Could not queue document retry.");
  if (!claimed) throw new AppError(409, "INVALID_STATUS", "This document has already been retried.");
  const { processDocument } = await import("./services/documents.js");
  enqueueWork(() => processDocument(data.id, req.user.id, buffer, data.mime_type, data.doc_type, data.raw_text || "", data.source_url), { task: "document_retry" })
    .catch((failure) => logger.error({ code: failure.code || "QUEUE_FAILED" }, "Document retry exhausted"));
  return send(res, { id: data.id, status: "processing" }, 202);
}));
router.get("/documents/:id/download", uuidParam("id"), asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("documents").select("storage_path").eq("user_id", req.user.id).eq("id", req.params.id).maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load the document.");
  if (!data?.storage_path) throw new AppError(404, "NOT_FOUND", "Document file not found.");
  const { data: signed, error: signedError } = await supabaseAdmin.storage.from(env.SUPABASE_STORAGE_BUCKET).createSignedUrl(data.storage_path, 60);
  if (signedError) throw new AppError(502, "STORAGE_ERROR", "Could not create a secure download link.");
  return send(res, { url: signed.signedUrl });
}));
router.delete("/documents/:id", uuidParam("id"), asyncRoute(async (req, res) => {
  await removeDocument(req.user.id, req.params.id);
  return send(res, { deleted: true });
}));

router.post("/profile/build", aiRateLimit, validate(emptyBodySchema), requireConsent, asyncRoute(async (req, res) => {
  const { data: docs, error } = await supabaseAdmin.from("documents").select("id, extracted").eq("user_id", req.user.id).eq("status", "processed").not("extracted", "is", null);
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not retrieve processed evidence.");
  if (!docs?.length) throw new AppError(409, "NO_PROCESSED_DOCUMENTS", "Process at least one document before building your profile.");
  const userId = req.user.id;
  enqueueWork(() => buildProfile(userId), { task: "profile_build" }).catch((failure) => {
    logger.error({ code: failure.code || "PROFILE_BUILD_FAILED" }, "Profile build failed");
    supabaseAdmin.from("notifications").insert({
      user_id: userId,
      type: "system",
      title: "Profile build failed",
      body: failure instanceof AppError
        ? failure.message
        : "We could not build your profile due to a server error. Please try again later.",
    }).then(({ error: notificationError }) => {
      if (notificationError) logger.warn({ code: notificationError.code }, "Could not save profile failure notification");
    });
  });
  return send(res, { status: "processing" }, 202);
}));
router.get("/profile", asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("candidate_profiles").select("*").eq("user_id", req.user.id).eq("is_current", true).maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load your profile.");
  return send(res, data || {});
}));
const overrideSchema = z.object({
  summary: z.string().trim().max(2000).optional(),
  education: z.array(z.record(z.unknown())).optional(),
  work_experience: z.array(z.record(z.unknown())).optional(),
  projects: z.array(z.record(z.unknown())).optional(),
  certifications: z.array(z.record(z.unknown())).optional(),
  specializations: z.array(z.string().trim().max(100)).max(5).optional(),
  strengths: z.array(z.object({ title: z.string().max(120), reason: z.string().max(500) })).max(8).optional(),
}).strict();
router.patch("/profile/overrides", validate(overrideSchema), asyncRoute(async (req, res) => {
  const { data: current, error: loadError } = await supabaseAdmin.from("candidate_profiles").select("id, user_overrides").eq("user_id", req.user.id).eq("is_current", true).maybeSingle();
  if (loadError) throw new AppError(500, "DATABASE_ERROR", "Could not load your profile.");
  if (!current) throw new AppError(404, "PROFILE_NOT_FOUND", "Build your profile before editing it.");
  const overrides = { ...(current.user_overrides || {}), ...req.body };
  const { data, error } = await supabaseAdmin.from("candidate_profiles").update({ ...req.body, user_overrides: overrides }).eq("id", current.id).eq("user_id", req.user.id).select("*").single();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not save profile changes.");
  return send(res, data);
}));
router.patch("/profile/skills/:name", validate(z.object({ name: z.string().min(1).max(100) }).passthrough(), "params"), validate(z.object({
  level: z.enum(["strong", "intermediate", "basic", "needs_assessment"]).optional(),
  user_confirmed: z.boolean().optional(),
}).strict()), asyncRoute(async (req, res) => {
  const { data: current, error: loadError } = await supabaseAdmin.from("candidate_profiles").select("id, skills, user_overrides").eq("user_id", req.user.id).eq("is_current", true).maybeSingle();
  if (loadError) throw new AppError(500, "DATABASE_ERROR", "Could not load your profile.");
  if (!current) throw new AppError(404, "PROFILE_NOT_FOUND", "Build your profile before editing skills.");
  const skillName = decodeURIComponent(req.params.name).trim().toLowerCase();
  const skills = (current.skills || []).map((skill) => {
    if (String(skill.normalized_name || skill.name).trim().toLowerCase() !== skillName) return skill;
    return { ...skill, ...req.body, user_confirmed: req.body.user_confirmed ?? true };
  });
  if (!skills.some((skill) => String(skill.normalized_name || skill.name).trim().toLowerCase() === skillName)) {
    throw new AppError(404, "SKILL_NOT_FOUND", "Skill not found in your profile.");
  }
  const overrides = { ...(current.user_overrides || {}), skills };
  const { data, error } = await supabaseAdmin.from("candidate_profiles").update({ skills, user_overrides: overrides }).eq("id", current.id).eq("user_id", req.user.id).select("*").single();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not update this skill.");
  return send(res, data);
}));
router.get("/evidence", asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("candidate_profiles").select("evidence_report").eq("user_id", req.user.id).eq("is_current", true).maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load evidence analysis.");
  return send(res, data?.evidence_report || {});
}));

router.get("/careers", asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("career_recommendations").select("*").eq("user_id", req.user.id).order("suitability_score", { ascending: false });
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load career recommendations.");
  return send(res, data || []);
}));
router.get("/careers/:id", uuidParam("id"), asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("career_recommendations").select("*").eq("user_id", req.user.id).eq("id", req.params.id).maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load the career recommendation.");
  if (!data) throw new AppError(404, "NOT_FOUND", "Career recommendation not found.");
  return send(res, data, 200, { disclaimer: "AI-generated insights are advisory and are not hiring decisions." });
}));
router.post("/careers/refresh", aiRateLimit, validate(emptyBodySchema), requireConsent, asyncRoute(async (req, res) => {
  const userId = req.user.id;
  enqueueWork(() => refreshCareerRecommendations(userId), { task: "career_refresh" }).catch((error) => {
    logger.error({ code: error.code || "CAREER_REFRESH_FAILED" }, "Career recommendation refresh failed");
  });
  return send(res, { status: "processing" }, 202, { disclaimer: DISCLAIMER });
}));

router.get("/jobs/matches", asyncRoute(async (req, res) => {
  const querySchema = z.object({
    min_score: z.coerce.number().int().min(0).max(100).default(0),
    location: z.string().max(100).optional(),
    company: z.string().max(100).optional(),
    role: z.string().trim().min(2).max(120).optional(),
    remote: z.enum(["true", "false"]).optional(),
    sort: z.enum(["score", "recent"]).default("score"),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }).safeParse(req.query);
  if (!querySchema.success) throw querySchema.error;
  const filters = querySchema.data;
  let query = supabaseAdmin.from("job_matches").select("*, jobs!inner(id, company_name, title, location, is_remote, job_type, salary_min, salary_max, official_apply_url, status, application_deadline)", { count: "exact" })
    .eq("user_id", req.user.id).eq("jobs.status", "open").eq("is_dismissed", false).gte("compatibility_score", filters.min_score);
  query = query.or(`application_deadline.is.null,application_deadline.gte.${new Date().toISOString().slice(0, 10)}`, { referencedTable: "jobs" });
  if (filters.location) query = query.ilike("jobs.location", `%${filters.location}%`);
  if (filters.company) query = query.ilike("jobs.company_name", `%${filters.company}%`);
  if (filters.role) query = query.ilike("jobs.title", `%${filters.role}%`);
  if (filters.remote) query = query.eq("jobs.is_remote", filters.remote === "true");
  query = query.order(filters.sort === "recent" ? "created_at" : "compatibility_score", { ascending: filters.sort === "recent" });
  const from = (filters.page - 1) * filters.limit;
  const { data, error, count } = await query.range(from, from + filters.limit - 1);
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load matching jobs.");
  return send(res, { items: data || [], total: count || 0, page: filters.page, limit: filters.limit });
}));
router.get("/jobs/:id", uuidParam("id"), asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("jobs").select("*").eq("id", req.params.id).eq("status", "open").maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load the job.");
  if (!data || (data.application_deadline && String(data.application_deadline).slice(0, 10) < new Date().toISOString().slice(0, 10))) {
    throw new AppError(404, "NOT_FOUND", "Open job not found.");
  }
  return send(res, data);
}));
router.post("/jobs/:id/explain", uuidParam("id"), aiRateLimit, validate(emptyBodySchema), requireConsent, asyncRoute(async (req, res) => {
  const [{ data: profile, error: profileError }, { data: job, error: jobError }, { data: preference, error: preferenceError }] = await Promise.all([
    supabaseAdmin.from("candidate_profiles").select("*").eq("user_id", req.user.id).eq("is_current", true).maybeSingle(),
    supabaseAdmin.from("jobs").select("*").eq("id", req.params.id).eq("status", "open").maybeSingle(),
    supabaseAdmin.from("preferences").select("*").eq("user_id", req.user.id).maybeSingle(),
  ]);
  if (profileError || jobError || preferenceError) throw new AppError(500, "DATABASE_ERROR", "Could not load profile, job, or preferences.");
  if (!profile) throw new AppError(409, "PROFILE_NOT_FOUND", "Build your profile before requesting a job explanation.");
  if (!job || (job.application_deadline && String(job.application_deadline).slice(0, 10) < new Date().toISOString().slice(0, 10))) {
    throw new AppError(404, "NOT_FOUND", "Open job not found.");
  }
  const match = matchJob(profile, job, preference || {});
  if (!match) throw new AppError(404, "JOB_NOT_RECOMMENDED", "This job does not currently meet the recommendation threshold.");
  const explanation = await runStructured({
    model: env.GEMINI_MODEL,
    systemInstruction: `${systemInstruction}\nThe score and breakdown below are computed by code and are final. Explain alignment and gaps without changing them.`,
    parts: [{ text: `<job_posting>${JSON.stringify({ job, profile_skills: profile.skills, score: match.compatibility_score, score_breakdown: match.score_breakdown, matched_skills: match.matched_skills, missing_skills: match.missing_skills, eligibility_flags: match.eligibility_flags })}</job_posting>` }],
    schema: jobExplanationSchema,
  });
  const { error } = await supabaseAdmin.from("job_matches")
    .update({ explanation })
    .eq("user_id", req.user.id).eq("job_id", job.id);
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not save the job explanation.");
  return send(res, { ...explanation, compatibility_score: match.compatibility_score, score_breakdown: match.score_breakdown }, 200, { disclaimer: DISCLAIMER });
}));
router.patch("/jobs/matches/:matchId", uuidParam("matchId"), asyncRoute(async (req, res) => {
  const bodySchema = z.object({ is_saved: z.boolean().optional(), is_dismissed: z.boolean().optional() }).strict();
  const { data: body, error: validationError } = bodySchema.safeParse(req.body);
  if (validationError) throw validationError;
  const { data, error } = await supabaseAdmin.from("job_matches").update(body).eq("id", req.params.matchId).eq("user_id", req.user.id).select("id, is_saved, is_dismissed").maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not update this job match.");
  if (!data) throw new AppError(404, "NOT_FOUND", "Job match not found.");
  return send(res, data);
}));
router.post("/jobs/match/refresh", validate(emptyBodySchema), requireConsent, asyncRoute(async (req, res) => {
  await refreshMatchesForUser(req.user.id);
  return send(res, { refreshed: true });
}));

router.get("/skill-gaps", asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("skill_gap_reports").select("*").eq("user_id", req.user.id).order("created_at", { ascending: false });
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load skill-gap reports.");
  return send(res, data || []);
}));
router.post("/skill-gaps", aiRateLimit, requireConsent, asyncRoute(async (req, res) => {
  const targetSchema = z.object({
    target_type: z.enum(["career", "job"]),
    career_id: z.string().uuid().optional(),
    job_id: z.string().uuid().optional(),
  }).strict().superRefine((value, context) => {
    if (value.target_type === "career" && !value.career_id) context.addIssue({ code: z.ZodIssueCode.custom, path: ["career_id"], message: "Career ID is required." });
    if (value.target_type === "job" && !value.job_id) context.addIssue({ code: z.ZodIssueCode.custom, path: ["job_id"], message: "Job ID is required." });
  });
  const target = targetSchema.parse(req.body);
  const { data: profile, error: profileError } = await supabaseAdmin.from("candidate_profiles").select("*").eq("user_id", req.user.id).eq("is_current", true).maybeSingle();
  if (profileError) throw new AppError(500, "DATABASE_ERROR", "Could not load the current profile.");
  if (!profile) throw new AppError(409, "PROFILE_NOT_FOUND", "Build your profile before creating a skill roadmap.");
  let destination;
  if (target.target_type === "career") {
    const { data, error } = await supabaseAdmin.from("career_recommendations").select("*").eq("user_id", req.user.id).eq("id", target.career_id).maybeSingle();
    if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load the selected career.");
    if (!data) throw new AppError(404, "NOT_FOUND", "Career recommendation not found.");
    destination = data;
  } else {
    const { data, error } = await supabaseAdmin.from("jobs").select("*").eq("id", target.job_id).eq("status", "open").maybeSingle();
    if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load the selected job.");
    if (!data) throw new AppError(404, "NOT_FOUND", "Open job not found.");
    destination = data;
  }
  const report = await runStructured({
    model: env.GEMINI_MODEL_HEAVY,
    systemInstruction: `${systemInstruction}\nCompare the profile with the target. Recommend practical learning resources by type only, never invent course URLs. Return exactly three phases: 0-4 weeks, 1-3 months, and 3-6 months.`,
    parts: [{ text: `<candidate_document>${JSON.stringify(profile)}</candidate_document>\n<${target.target_type === "job" ? "job_posting" : "career_target"}>${JSON.stringify(destination)}</${target.target_type === "job" ? "job_posting" : "career_target"}>` }],
    schema: skillGapSchema,
  });
  const { data, error } = await supabaseAdmin.from("skill_gap_reports").insert({
    user_id: req.user.id,
    target_type: target.target_type,
    career_id: target.career_id || null,
    job_id: target.job_id || null,
    report,
  }).select("*").single();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not save the skill roadmap.");
  return send(res, data, 201, { disclaimer: DISCLAIMER });
}));
router.get("/skill-gaps/:id", uuidParam("id"), asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("skill_gap_reports").select("*").eq("user_id", req.user.id).eq("id", req.params.id).maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load this skill-gap report.");
  if (!data) throw new AppError(404, "NOT_FOUND", "Skill-gap report not found.");
  return send(res, data);
}));
router.delete("/skill-gaps/:id", uuidParam("id"), asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("skill_gap_reports").delete()
    .eq("user_id", req.user.id).eq("id", req.params.id).select("id").maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not delete this skill roadmap.");
  if (!data) throw new AppError(404, "NOT_FOUND", "Skill roadmap not found.");
  return send(res, { deleted: true });
}));

router.get("/notifications", asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("notifications").select("*").eq("user_id", req.user.id).order("created_at", { ascending: false }).limit(100);
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load notifications.");
  return send(res, data || []);
}));
router.patch("/notifications/:id/read", uuidParam("id"), asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("notifications").update({ is_read: true }).eq("user_id", req.user.id).eq("id", req.params.id).select("*").maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not update this notification.");
  if (!data) throw new AppError(404, "NOT_FOUND", "Notification not found.");
  return send(res, data);
}));
router.delete("/notifications/:id", uuidParam("id"), asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("notifications").delete()
    .eq("user_id", req.user.id).eq("id", req.params.id).select("id").maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not delete this notification.");
  if (!data) throw new AppError(404, "NOT_FOUND", "Notification not found.");
  return send(res, { deleted: true });
}));
router.post("/notifications/read-all", validate(emptyBodySchema), asyncRoute(async (req, res) => {
  const { error } = await supabaseAdmin.from("notifications").update({ is_read: true }).eq("user_id", req.user.id).eq("is_read", false);
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not mark notifications as read.");
  return send(res, { updated: true });
}));

router.get("/account/export", asyncRoute(async (req, res) => {
  const tables = ["profiles", "preferences", "documents", "candidate_profiles", "career_recommendations", "job_matches", "recruiter_job_matches", "skill_gap_reports", "notifications", "mock_interviews", "recruiter_access_requests", "recruiter_jobs", "recruiter_shortlists", "recruiter_interviews"];
  const entries = await Promise.all(tables.map(async (table) => {
    const ownerField = table === "profiles" ? "id"
      : table === "recruiter_access_requests" ? "user_id"
        : table === "recruiter_job_matches" ? "candidate_id"
          : ["recruiter_jobs", "recruiter_shortlists", "recruiter_interviews"].includes(table) ? "recruiter_id"
          : "user_id";
    const { data, error } = await supabaseAdmin.from(table).select("*").eq(ownerField, req.user.id);
    if (error) throw new AppError(500, "DATABASE_ERROR", `Could not export ${table}.`);
    return [table, data || []];
  }));
  const { data: candidateApplications, error: candidateApplicationsError } = await supabaseAdmin
    .from("recruiter_job_applications").select("*").eq("candidate_id", req.user.id);
  const { data: recruiterApplications, error: recruiterApplicationsError } = await supabaseAdmin
    .from("recruiter_job_applications").select("*").eq("recruiter_id", req.user.id);
  if (candidateApplicationsError || recruiterApplicationsError) throw new AppError(500, "DATABASE_ERROR", "Could not export job applications.");
  entries.push(["recruiter_job_applications", [...new Map([...(candidateApplications || []), ...(recruiterApplications || [])].map((application) => [application.id, application])).values()]]);
  return send(res, Object.fromEntries(entries));
}));
router.delete("/account", asyncRoute(async (req, res) => {
  const { data: documents, error: docsError } = await supabaseAdmin.from("documents").select("storage_path").eq("user_id", req.user.id);
  if (docsError) throw new AppError(500, "DATABASE_ERROR", "Could not prepare account deletion.");
  const paths = (documents || []).map((doc) => doc.storage_path).filter(Boolean);
  if (paths.length) {
    const { error: storageError } = await supabaseAdmin.storage.from(env.SUPABASE_STORAGE_BUCKET).remove(paths);
    if (storageError) throw new AppError(502, "STORAGE_ERROR", "Could not delete stored documents.");
  }
  const { error } = await supabaseAdmin.auth.admin.deleteUser(req.user.id);
  if (error) throw new AppError(500, "ACCOUNT_DELETE_FAILED", "Could not delete the account.");
  return send(res, { deleted: true });
}));

router.post("/recruiter/access-requests", asyncRoute(async (req, res) => {
  if (req.user.app_metadata?.role === "recruiter" || req.user.app_metadata?.role === "admin") {
    throw new AppError(409, "RECRUITER_ACCESS_EXISTS", "This account already has an assigned role.");
  }
  const bodySchema = z.object({ company_name: z.string().trim().min(2).max(200) }).strict();
  const body = bodySchema.parse(req.body);
  const { data: existingRequest, error: existingError } = await supabaseAdmin.from("recruiter_access_requests")
    .select("status").eq("user_id", req.user.id).maybeSingle();
  if (existingError) throw new AppError(500, "DATABASE_ERROR", "Could not check your recruiter access request.");
  if (existingRequest?.status === "approved") throw new AppError(409, "RECRUITER_ACCESS_EXISTS", "Recruiter access has already been approved for this account.");
  const { data, error } = await supabaseAdmin.from("recruiter_access_requests").upsert({
    user_id: req.user.id,
    full_name: req.user.user_metadata?.full_name || req.user.email?.split("@")[0] || "Recruiter applicant",
    email: req.user.email || "",
    company_name: body.company_name,
    status: "pending",
  }, { onConflict: "user_id" }).select("id, company_name, status, created_at").single();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not submit your recruiter access request.");
  return send(res, data, 201);
}));

router.get("/recruiter/access-request", asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("recruiter_access_requests")
    .select("company_name, status, created_at").eq("user_id", req.user.id).maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load your recruiter access request.");
  return send(res, data);
}));

router.get("/admin/recruiter-requests", requireAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await supabaseAdmin.from("recruiter_access_requests")
    .select("*").order("created_at", { ascending: false });
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load recruiter access requests.");
  return send(res, data || []);
}));

router.patch("/admin/recruiter-requests/:id", requireAdmin, uuidParam("id"), asyncRoute(async (req, res) => {
  const body = z.object({ status: z.enum(["approved", "rejected"]) }).strict().parse(req.body);
  const { data: request, error: requestError } = await supabaseAdmin.from("recruiter_access_requests")
    .select("*").eq("id", req.params.id).maybeSingle();
  if (requestError) throw new AppError(500, "DATABASE_ERROR", "Could not load this recruiter request.");
  if (!request) throw new AppError(404, "NOT_FOUND", "Recruiter access request not found.");
  if (request.status !== "pending") {
    if (request.status === body.status) return send(res, request);
    throw new AppError(409, "REQUEST_ALREADY_REVIEWED", "This recruiter request has already been reviewed.");
  }
  if (body.status === "approved") {
    const { data: userResult, error: userError } = await supabaseAdmin.auth.admin.getUserById(request.user_id);
    if (userError || !userResult.user) throw new AppError(500, "AUTH_USER_LOOKUP_FAILED", "Could not load the applicant account.");
    if (userResult.user.app_metadata?.role === "admin") {
      throw new AppError(409, "ROLE_CONFLICT", "An administrator account cannot be changed to a recruiter account.");
    }
    const { error: companyError } = await supabaseAdmin.from("profiles")
      .update({ role: "recruiter", company_name: request.company_name, updated_at: new Date().toISOString() }).eq("id", request.user_id);
    if (companyError) throw new AppError(500, "DATABASE_ERROR", "Could not save the applicant company.");
    const { error: roleError } = await supabaseAdmin.auth.admin.updateUserById(request.user_id, {
      app_metadata: { ...userResult.user.app_metadata, role: "recruiter" },
    });
    if (roleError) throw new AppError(500, "RECRUITER_APPROVAL_FAILED", "Could not approve recruiter access.");
  }
  const { data, error } = await supabaseAdmin.from("recruiter_access_requests")
    .update({ status: body.status }).eq("id", req.params.id).select("*").single();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not update this recruiter request.");
  return send(res, data);
}));

router.delete("/admin/recruiter-requests/:id", requireAdmin, uuidParam("id"), asyncRoute(async (req, res) => {
  return send(res, await revokeRecruiterAccess(req.params.id));
}));

// --- Recruiter & Outreach Endpoints ---
router.get("/recruiter/candidates", requireRecruiter, asyncRoute(async (req, res) => {
  const candidates = await searchCandidates({
    search: req.query.search || "",
    skill: req.query.skill || "",
    minExperience: req.query.min_experience ? parseInt(req.query.min_experience, 10) : 0,
    highestEducation: req.query.education || "",
    limit: req.query.limit ? parseInt(req.query.limit, 10) : 50,
  });
  return send(res, candidates);
}));

router.get("/recruiter/candidates/:id", requireRecruiter, uuidParam("id"), asyncRoute(async (req, res) => {
  const candidate = await getCandidateDetail(req.params.id);
  return send(res, candidate);
}));

router.post("/recruiter/inquiries", requireRecruiter, asyncRoute(async (req, res) => {
  const inquiry = await sendRecruiterInquiry(req.user, req.body);
  return send(res, inquiry, 201);
}));

router.get("/recruiter/inquiries", requireRecruiter, asyncRoute(async (req, res) => {
  const inquiries = await listRecruiterInquiries(req.user.id);
  return send(res, inquiries);
}));

router.get("/recruiter/jobs", requireRecruiter, asyncRoute(async (req, res) => {
  return send(res, await listRecruiterJobs(req.user.id));
}));
router.get("/recruiter/company", requireRecruiter, asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("profiles")
    .select("full_name, company_name, contact_email, contact_phone").eq("id", req.user.id).maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load your company profile.");
  return send(res, data || {});
}));
router.patch("/recruiter/company", requireRecruiter, asyncRoute(async (req, res) => {
  const input = z.object({
    company_name: z.string().trim().min(2).max(200),
    contact_email: z.string().email().nullable().optional(),
    contact_phone: z.string().trim().max(40).nullable().optional(),
  }).strict().parse(req.body);
  const { data, error } = await supabaseAdmin.from("profiles")
    .update({ ...input, updated_at: new Date().toISOString() }).eq("id", req.user.id)
    .select("full_name, company_name, contact_email, contact_phone").single();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not update your company profile.");
  return send(res, data);
}));
router.post("/recruiter/jobs", requireRecruiter, asyncRoute(async (req, res) => {
  return send(res, await createRecruiterJob(req.user.id, req.body), 201);
}));
router.patch("/recruiter/jobs/:id", requireRecruiter, uuidParam("id"), asyncRoute(async (req, res) => {
  return send(res, await updateRecruiterJob(req.user.id, req.params.id, req.body));
}));
router.get("/recruiter/jobs/:id/applications", requireRecruiter, uuidParam("id"), asyncRoute(async (req, res) => {
  const { data: job, error } = await supabaseAdmin.from("recruiter_jobs")
    .select("id").eq("id", req.params.id).eq("recruiter_id", req.user.id).maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load this job.");
  if (!job) throw new AppError(404, "JOB_NOT_FOUND", "Job not found.");
  return send(res, await listRecruiterApplications(req.user.id, req.params.id));
}));
router.get("/recruiter/applications", requireRecruiter, asyncRoute(async (req, res) => {
  return send(res, await listRecruiterApplications(req.user.id));
}));
router.patch("/recruiter/applications/:id", requireRecruiter, uuidParam("id"), asyncRoute(async (req, res) => {
  return send(res, await updateRecruiterApplication(req.user.id, req.params.id, req.body));
}));
router.get("/recruiter/shortlisted", requireRecruiter, asyncRoute(async (req, res) => {
  return send(res, await listRecruiterShortlist(req.user.id));
}));
router.post("/recruiter/shortlisted/:candidateProfileId", requireRecruiter, uuidParam("candidateProfileId"), asyncRoute(async (req, res) => {
  return send(res, await addRecruiterShortlist(req.user.id, req.params.candidateProfileId), 201);
}));
router.delete("/recruiter/shortlisted/:candidateProfileId", requireRecruiter, uuidParam("candidateProfileId"), asyncRoute(async (req, res) => {
  return send(res, await removeRecruiterShortlist(req.user.id, req.params.candidateProfileId));
}));
router.get("/recruiter/interviews", requireRecruiter, asyncRoute(async (req, res) => {
  return send(res, await listRecruiterInterviews(req.user.id));
}));
router.post("/recruiter/interviews", requireRecruiter, asyncRoute(async (req, res) => {
  return send(res, await scheduleRecruiterInterview(req.user.id, req.body), 201);
}));
router.patch("/recruiter/interviews/:id", requireRecruiter, uuidParam("id"), asyncRoute(async (req, res) => {
  return send(res, await updateRecruiterInterview(req.user.id, req.params.id, req.body));
}));

router.get("/jobs/recruiter-posts", requireCandidate, asyncRoute(async (req, res) => {
  return send(res, await listOpenRecruiterJobs(req.user.id));
}));
router.post("/jobs/recruiter-posts/:id/applications", requireCandidate, uuidParam("id"), asyncRoute(async (req, res) => {
  return send(res, await applyToRecruiterJob(req.user.id, req.params.id, req.body), 201);
}));
router.get("/applications", requireCandidate, asyncRoute(async (req, res) => {
  return send(res, await listCandidateApplications(req.user.id));
}));

// Candidate inquiries view & response
router.get("/inquiries", asyncRoute(async (req, res) => {
  const inquiries = await listCandidateInquiries(req.user.id);
  return send(res, inquiries);
}));

router.patch("/inquiries/:id", uuidParam("id"), asyncRoute(async (req, res) => {
  const updated = await respondToInquiry(req.user.id, req.params.id, req.body);
  return send(res, updated);
}));

router.get("/admin/job-sources", requireAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await supabaseAdmin.from("job_sources").select("*").order("company_name");
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load job sources.");
  return send(res, data || []);
}));
router.post("/admin/job-sources", requireAdmin, asyncRoute(async (req, res) => {
  return send(res, await createJobSource(req.body), 201);
}));
router.patch("/admin/job-sources/:id", requireAdmin, uuidParam("id"), validate(z.object({ is_active: z.boolean() }).strict()), asyncRoute(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("job_sources").update({ is_active: req.body.is_active }).eq("id", req.params.id).select("*").maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not update this job source.");
  if (!data) throw new AppError(404, "NOT_FOUND", "Job source not found.");
  return send(res, data);
}));
router.post("/admin/jobs/sync", requireAdmin, validate(emptyBodySchema), asyncRoute(async (_req, res) => {
  return send(res, await syncActiveSources());
}));
router.post("/admin/jobs", requireAdmin, asyncRoute(async (req, res) => {
  return send(res, await createManualJob(req.body), 201);
}));

app.use("/api/v1", router);
app.use(notFoundHandler);
app.use((error, req, _res, next) => {
  if (error instanceof multer.MulterError) {
    return next(new AppError(error.code === "LIMIT_FILE_SIZE" ? 413 : 400, "UPLOAD_ERROR", error.code === "LIMIT_FILE_SIZE" ? "The uploaded file exceeds the allowed size." : "The upload request is invalid."));
  }
  if (error && typeof error === "object" && "status" in error && !error.code) {
    logger.warn({ status: error.status, route: req.route?.path || "unmatched" }, "Request rejected by middleware");
  }
  return next(error);
});
app.use(errorHandler);

export default app;
