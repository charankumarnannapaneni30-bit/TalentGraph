import { env } from "../config/env.js";
import { supabaseAdmin } from "../utils/supabase.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { runStructured } from "../ai/runStructured.js";
import { systemInstruction } from "../ai/prompts/system.js";
import { careerRecommendationsSchema, profileSchema } from "../ai/schemas/profile.js";
import { matchJob } from "./matching.js";
import { sendJobMatchNotificationEmail } from "./notificationEmails.js";

const selectData = async (table, selection, userId, filters = []) => {
  let query = supabaseAdmin.from(table).select(selection).eq("user_id", userId);
  for (const [field, value] of filters) query = query.eq(field, value);
  const { data, error } = await query;
  if (error) throw new AppError(500, "DATABASE_ERROR", `Could not load ${table}.`);
  return data || [];
};

async function assertConsent(userId) {
  const { data, error } = await supabaseAdmin.from("profiles")
    .select("consent_ai_processing").eq("id", userId).maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not verify AI-processing consent.");
  if (data?.consent_ai_processing !== true) throw new AppError(403, "CONSENT_REQUIRED", "AI-processing consent is required.");
}

async function synthesizeProfile(userId) {
  const allDocuments = await selectData("documents", "id, doc_type, extracted", userId, [["status", "processed"]]);
  const documents = allDocuments.filter((document) => document.extracted);
  if (!documents.length) throw new AppError(409, "NO_PROCESSED_DOCUMENTS", "Process at least one document before building your profile.");
  await assertConsent(userId);
  const existingProfiles = await selectData("candidate_profiles", "id, version, user_overrides, is_current", userId);
  const currentProfile = existingProfiles.find((profile) => profile.is_current);
  const overrides = currentProfile?.user_overrides || {};
  const input = documents.map(({ id, doc_type, extracted }) => ({ document_id: id, doc_type, extracted }));
  const profile = await runStructured({
    model: env.GEMINI_MODEL,
    systemInstruction: `${systemInstruction}\nSynthesize a single profile from the supplied data. Every skill must include level_reasoning and evidence. A skill supported only by a claim must be needs_assessment or unsupported. Apply user overrides as authoritative.`,
    parts: [{
      text: `<candidate_document>${JSON.stringify(input)}</candidate_document>\n<user_overrides>${JSON.stringify(overrides)}</user_overrides>`,
    }],
    schema: profileSchema,
  });
  await assertConsent(userId);
  const overridden = { ...profile, ...overrides };
  for (const skill of overridden.skills || []) {
    if (!skill.evidence?.length && skill.claimed) {
      skill.level = "needs_assessment";
      skill.evidence_strength = "none";
      skill.level_reasoning = "This skill was claimed but no supporting evidence was found.";
    }
  }
  const nextVersion = existingProfiles.reduce((highest, profile) => Math.max(highest, profile.version), 0) + 1;
  const { data: inserted, error: saveError } = await supabaseAdmin.from("candidate_profiles").insert({
    user_id: userId,
    version: nextVersion,
    is_current: false,
    ...overridden,
    user_overrides: overrides,
    source_document_ids: documents.map((document) => document.id),
  }).select("*").single();
  if (saveError) throw new AppError(500, "DATABASE_ERROR", "Could not save your synthesized profile.");
  if (currentProfile) {
    const { error: demoteError } = await supabaseAdmin.from("candidate_profiles")
      .update({ is_current: false }).eq("user_id", userId).eq("id", currentProfile.id).eq("is_current", true);
    if (demoteError) {
      await supabaseAdmin.from("candidate_profiles").delete().eq("id", inserted.id).eq("user_id", userId);
      throw new AppError(500, "DATABASE_ERROR", "Could not version the previous profile.");
    }
  }
  const { data: saved, error: promoteError } = await supabaseAdmin.from("candidate_profiles")
    .update({ is_current: true }).eq("id", inserted.id).eq("user_id", userId).select("*").single();
  if (promoteError) {
    if (currentProfile) {
      await supabaseAdmin.from("candidate_profiles").update({ is_current: true })
        .eq("id", currentProfile.id).eq("user_id", userId);
    }
    await supabaseAdmin.from("candidate_profiles").delete().eq("id", inserted.id).eq("user_id", userId);
    throw new AppError(500, "DATABASE_ERROR", "Could not publish the new profile version.");
  }
  return saved;
}

async function buildCareers(userId, profile) {
  const preferences = (await selectData("preferences", "*", userId))[0] || {};
  await assertConsent(userId);
  const result = await runStructured({
    model: env.GEMINI_MODEL,
    systemInstruction: `${systemInstruction}\nRecommend 5 to 8 realistic career paths grounded in the profile. Return ranked paths and include one stretch path.`,
    parts: [{ text: `<candidate_document>${JSON.stringify({ profile, target_roles: preferences.target_roles || [] })}</candidate_document>` }],
    schema: careerRecommendationsSchema,
  });
  await assertConsent(userId);
  const rows = result.recommendations.sort((a, b) => b.suitability_score - a.suitability_score).map((recommendation) => ({
    user_id: userId,
    profile_id: profile.id,
    ...recommendation,
  }));
  const { error: deleteError } = await supabaseAdmin.from("career_recommendations").delete().eq("user_id", userId);
  if (deleteError) throw new AppError(500, "DATABASE_ERROR", "Could not replace prior career recommendations.");
  const { error } = await supabaseAdmin.from("career_recommendations").insert(rows);
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not save career recommendations.");
}

export async function refreshCareerRecommendations(userId) {
  await assertConsent(userId);
  const { data: profile, error } = await supabaseAdmin.from("candidate_profiles")
    .select("*").eq("user_id", userId).eq("is_current", true).maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load the current profile.");
  if (!profile) throw new AppError(409, "PROFILE_NOT_FOUND", "Build your profile before refreshing career recommendations.");
  await buildCareers(userId, profile);
  return profile;
}

async function refreshMatches(userId, profile, notificationType = "new_match") {
  const [preferencesRows, jobs] = await Promise.all([
    selectData("preferences", "*", userId),
    (async () => {
      const { data, error } = await supabaseAdmin.from("jobs").select("*").eq("status", "open");
      if (error) throw new AppError(500, "DATABASE_ERROR", "Could not retrieve open jobs.");
      return data || [];
    })(),
  ]);
  const preferences = preferencesRows[0] || {};
  const previous = await selectData("job_matches", "job_id, is_saved, is_dismissed", userId);
  const previousByJob = new Map(previous.map((match) => [match.job_id, match]));
  const matches = jobs.map((job) => {
    const score = matchJob(profile, job, preferences);
    if (!score) return null;
    const prior = previousByJob.get(job.id);
    return {
      user_id: userId,
      job_id: job.id,
      profile_id: profile.id,
      ...score,
      is_saved: prior?.is_saved || false,
      is_dismissed: prior?.is_dismissed || false,
    };
  }).filter(Boolean);
  const activeJobIds = new Set(matches.map((match) => match.job_id));
  const staleIds = previous.filter((match) => !activeJobIds.has(match.job_id)).map((match) => match.job_id);
  for (let offset = 0; offset < staleIds.length; offset += 100) {
    const batch = staleIds.slice(offset, offset + 100);
    const { error: staleError } = await supabaseAdmin.from("job_matches").delete().eq("user_id", userId).in("job_id", batch);
    if (staleError) throw new AppError(500, "DATABASE_ERROR", "Could not remove stale job matches.");
  }
  if (!matches.length) return;
  const { error } = await supabaseAdmin.from("job_matches").upsert(matches, { onConflict: "user_id,job_id" });
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not refresh job matches.");
  if (preferences.notify_new_matches) {
    const fresh = matches.filter((match) => !previousByJob.has(match.job_id) && match.compatibility_score >= (preferences.notify_min_score ?? 65));
    if (fresh.length) {
      const jobById = new Map(jobs.map((job) => [job.id, job]));
      const notices = fresh.map((match) => ({
        user_id: userId,
        type: notificationType,
        title: notificationType === "profile_unlock" ? "A job matches your new profile" : "A new job match is ready",
        body: `${jobById.get(match.job_id)?.title || "A job"} matches your profile.`,
        job_id: match.job_id,
      }));
      const { error: noticeError } = await supabaseAdmin.from("notifications").insert(notices);
      if (noticeError) {
        logger.warn({ code: noticeError.code }, "Could not save job match notification");
      } else {
        await sendJobMatchNotificationEmail(userId, notices);
      }
    }
  }
}

export async function refreshMatchesForUser(userId) {
  const { data: consent, error: consentError } = await supabaseAdmin.from("profiles")
    .select("consent_ai_processing").eq("id", userId).maybeSingle();
  if (consentError) throw new AppError(500, "DATABASE_ERROR", "Could not verify AI-processing consent.");
  if (consent?.consent_ai_processing !== true) return;
  const { data: profile, error } = await supabaseAdmin.from("candidate_profiles").select("*").eq("user_id", userId).eq("is_current", true).maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load the current profile.");
  if (!profile) return;
  await refreshMatches(userId, profile);
}

export async function buildProfile(userId) {
  await assertConsent(userId);
  const profile = await synthesizeProfile(userId);
  await buildCareers(userId, profile);
  await refreshMatches(userId, profile, profile.version === 1 ? "profile_unlock" : "new_match");
  const { error } = await supabaseAdmin.from("notifications").insert({
    user_id: userId,
    type: "profile_ready",
    title: "Your career profile is ready",
    body: "Review your evidence-backed skills and career recommendations.",
  });
  if (error) logger.warn({ code: error.code }, "Could not save profile-ready notification");
}
