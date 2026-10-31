import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { supabaseAdmin } from "../utils/supabase.js";
import { matchJob } from "./matching.js";
import { sendJobMatchNotificationEmail } from "./notificationEmails.js";

export async function refreshRecruiterJobMatches(jobId, onlyCandidateId = null) {
  const { data: job, error: jobError } = await supabaseAdmin.from("recruiter_jobs")
    .select("*").eq("id", jobId).eq("status", "open").maybeSingle();
  if (jobError) throw new AppError(500, "DATABASE_ERROR", "Could not load the recruiter job for matching.");
  if (!job) return [];

  let candidateQuery = supabaseAdmin.from("candidate_profiles")
    .select("*").eq("is_current", true);
  if (onlyCandidateId) candidateQuery = candidateQuery.eq("user_id", onlyCandidateId);
  const { data: profiles, error: candidateError } = await candidateQuery;
  if (candidateError) throw new AppError(500, "DATABASE_ERROR", "Could not load candidate profiles for job matching.");
  if (!profiles?.length) {
    let staleQuery = supabaseAdmin.from("recruiter_job_matches").delete().eq("recruiter_job_id", jobId);
    if (onlyCandidateId) staleQuery = staleQuery.eq("candidate_id", onlyCandidateId);
    const { error: staleError } = await staleQuery;
    if (staleError) throw new AppError(500, "DATABASE_ERROR", "Could not remove stale recruiter job matches.");
    return [];
  }

  const candidateIds = profiles.map((profile) => profile.user_id);
  const [{ data: accountProfiles, error: accountError }, { data: preferences, error: preferencesError }] = await Promise.all([
    supabaseAdmin.from("profiles").select("id, role, consent_ai_processing").in("id", candidateIds),
    supabaseAdmin.from("preferences").select("user_id, preferred_locations, open_to_remote, job_types, min_salary, excluded_companies, notify_new_matches, notify_min_score").in("user_id", candidateIds),
  ]);
  if (accountError || preferencesError) {
    throw new AppError(500, "DATABASE_ERROR", "Could not load candidate matching preferences.");
  }

  const accountById = new Map((accountProfiles || []).map((profile) => [profile.id, profile]));
  const preferenceById = new Map((preferences || []).map((preference) => [preference.user_id, preference]));
  const eligible = profiles.flatMap((profile) => {
    const account = accountById.get(profile.user_id);
    if (account?.role !== "candidate" || account.consent_ai_processing !== true) return [];
    const score = matchJob(profile, job, preferenceById.get(profile.user_id) || {});
    return score ? [{ profile, score, preferences: preferenceById.get(profile.user_id) || {} }] : [];
  });

  const { data: existingRows, error: existingError } = await supabaseAdmin.from("recruiter_job_matches")
    .select("candidate_id, compatibility_score, notified").eq("recruiter_job_id", jobId);
  if (existingError) throw new AppError(500, "DATABASE_ERROR", "Could not check previous recruiter job matches.");
  const existingByCandidate = new Map((existingRows || []).map((row) => [row.candidate_id, row]));
  const matches = eligible.map(({ profile, score }) => ({
    candidate_id: profile.user_id,
    recruiter_job_id: jobId,
    profile_id: profile.id,
    ...score,
    notified: existingByCandidate.get(profile.user_id)?.notified || false,
  }));
  const matchedIds = new Set(matches.map((match) => match.candidate_id));
  const staleIds = (existingRows || []).filter((row) => !matchedIds.has(row.candidate_id)).map((row) => row.candidate_id);
  if (staleIds.length) {
    const { error: staleError } = await supabaseAdmin.from("recruiter_job_matches")
      .delete().eq("recruiter_job_id", jobId).in("candidate_id", staleIds);
    if (staleError) throw new AppError(500, "DATABASE_ERROR", "Could not remove stale recruiter job matches.");
  }
  if (!matches.length) return [];

  const { error: upsertError } = await supabaseAdmin.from("recruiter_job_matches")
    .upsert(matches, { onConflict: "candidate_id,recruiter_job_id" });
  if (upsertError) throw new AppError(500, "DATABASE_ERROR", "Could not save recruiter job matches.");

  const newNotifications = eligible.flatMap(({ profile, score, preferences: candidatePreferences }) => {
    const previous = existingByCandidate.get(profile.user_id);
    const threshold = candidatePreferences.notify_min_score ?? 65;
    if (previous?.notified || candidatePreferences.notify_new_matches === false || score.compatibility_score < threshold) return [];
    return [{
      user_id: profile.user_id,
      type: "new_match",
      title: "A new recruiter job matches your profile",
      body: `${job.title} at ${job.company_name} matches your skills (${score.compatibility_score}% fit).`,
      recruiter_job_id: jobId,
    }];
  });

  if (newNotifications.length) {
    const { error: notificationError } = await supabaseAdmin.from("notifications").insert(newNotifications);
    if (notificationError) {
      logger.warn({ jobId, code: notificationError.code }, "Could not save recruiter job match notifications");
      throw new AppError(500, "JOB_MATCH_NOTIFICATION_FAILED", "The job was saved, but candidate match notifications could not be sent.");
    }

    const notifiedIds = newNotifications.map((notification) => notification.user_id);
    const { error: notifiedError } = await supabaseAdmin.from("recruiter_job_matches")
      .update({ notified: true }).eq("recruiter_job_id", jobId).in("candidate_id", notifiedIds);
    if (notifiedError) logger.warn({ jobId, code: notifiedError.code }, "Could not mark recruiter job matches as notified");

    const notificationsByCandidate = new Map();
    for (const notification of newNotifications) {
      const rows = notificationsByCandidate.get(notification.user_id) || [];
      rows.push(notification);
      notificationsByCandidate.set(notification.user_id, rows);
    }
    await Promise.all([...notificationsByCandidate].map(([candidateId, rows]) => (
      sendJobMatchNotificationEmail(candidateId, rows)
    )));
  }

  return matches;
}

export async function refreshRecruiterMatchesForCandidate(candidateId) {
  const { data: jobs, error } = await supabaseAdmin.from("recruiter_jobs").select("id").eq("status", "open");
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load open recruiter jobs for profile matching.");
  for (const job of jobs || []) await refreshRecruiterJobMatches(job.id, candidateId);
}
