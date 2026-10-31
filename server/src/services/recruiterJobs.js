import { z } from "zod";
import { supabaseAdmin } from "../utils/supabase.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { getCandidateDetail } from "./recruiter.js";

const jobInputSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().min(10).max(8000),
  location: z.string().trim().max(200).nullable().optional(),
  job_type: z.enum(["full_time", "part_time", "internship", "contract"]).nullable().optional(),
}).strict();

const applicationInputSchema = z.object({
  message: z.string().trim().min(10).max(3000),
}).strict();

async function notifyCandidate(candidateId, title, body, interviewId) {
  const { error } = await supabaseAdmin.from("notifications").insert({
    user_id: candidateId,
    type: "system",
    title,
    body,
    is_read: false,
  });
  if (!error) return true;
  logger.warn({ err: error, interviewId }, "Interview was updated but candidate notification failed");
  return false;
}

export async function createRecruiterJob(recruiterId, input) {
  const parsed = jobInputSchema.parse(input);
  const { data: profile, error: profileError } = await supabaseAdmin.from("profiles")
    .select("company_name").eq("id", recruiterId).maybeSingle();
  if (profileError) throw new AppError(500, "DATABASE_ERROR", "Could not load your company profile.");
  if (!profile?.company_name) throw new AppError(409, "COMPANY_REQUIRED", "Add your company name before posting a job.");

  const { data, error } = await supabaseAdmin.from("recruiter_jobs")
    .insert({ ...parsed, recruiter_id: recruiterId, company_name: profile.company_name })
    .select("*").single();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not create this job.");
  return data;
}

export async function listRecruiterJobs(recruiterId) {
  const { data, error } = await supabaseAdmin.from("recruiter_jobs")
    .select("*").eq("recruiter_id", recruiterId).order("created_at", { ascending: false });
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load your jobs.");
  return data || [];
}

export async function updateRecruiterJob(recruiterId, jobId, input) {
  const parsed = z.object({ status: z.enum(["open", "closed"]) }).strict().parse(input);
  const { data, error } = await supabaseAdmin.from("recruiter_jobs")
    .update({ status: parsed.status }).eq("id", jobId).eq("recruiter_id", recruiterId)
    .select("*").maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not update this job posting.");
  if (!data) throw new AppError(404, "JOB_NOT_FOUND", "Job posting not found.");
  return data;
}

export async function listOpenRecruiterJobs() {
  const { data, error } = await supabaseAdmin.from("recruiter_jobs")
    .select("id, company_name, title, description, location, job_type, created_at")
    .eq("status", "open").order("created_at", { ascending: false });
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load recruiter job postings.");
  return data || [];
}

export async function applyToRecruiterJob(candidateId, jobId, input) {
  const parsed = applicationInputSchema.parse(input);
  const { data: job, error: jobError } = await supabaseAdmin.from("recruiter_jobs")
    .select("id, recruiter_id").eq("id", jobId).eq("status", "open").maybeSingle();
  if (jobError) throw new AppError(500, "DATABASE_ERROR", "Could not load this job.");
  if (!job) throw new AppError(404, "JOB_NOT_FOUND", "This job is no longer available.");

  const { data, error } = await supabaseAdmin.from("recruiter_job_applications")
    .insert({ job_id: job.id, recruiter_id: job.recruiter_id, candidate_id: candidateId, message: parsed.message })
    .select("id, job_id, status, created_at").single();
  if (error?.code === "23505") throw new AppError(409, "ALREADY_APPLIED", "You have already applied to this job.");
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not submit your application.");
  return data;
}

export async function listRecruiterApplications(recruiterId, jobId) {
  let query = supabaseAdmin.from("recruiter_job_applications").select("*")
    .eq("recruiter_id", recruiterId).order("created_at", { ascending: false });
  if (jobId) query = query.eq("job_id", jobId);
  const { data: applications, error } = await query;
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load job applications.");
  if (!applications?.length) return [];

  const candidateIds = [...new Set(applications.map((application) => application.candidate_id))];
  const jobIds = [...new Set(applications.map((application) => application.job_id))];
  const [{ data: profiles, error: profilesError }, { data: jobs, error: jobsError }] = await Promise.all([
    supabaseAdmin.from("profiles").select("id, full_name").in("id", candidateIds),
    supabaseAdmin.from("recruiter_jobs").select("id, title").in("id", jobIds).eq("recruiter_id", recruiterId),
  ]);
  if (profilesError || jobsError) throw new AppError(500, "DATABASE_ERROR", "Could not load application details.");
  const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const jobById = new Map((jobs || []).map((job) => [job.id, job]));
  return applications.map((application) => ({
    ...application,
    candidate_name: profileById.get(application.candidate_id)?.full_name || "Candidate",
    job_title: jobById.get(application.job_id)?.title || "Job posting",
  }));
}

export async function listCandidateApplications(candidateId) {
  const { data: applications, error } = await supabaseAdmin.from("recruiter_job_applications")
    .select("id, job_id, status, message, created_at").eq("candidate_id", candidateId).order("created_at", { ascending: false });
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load your applications.");
  if (!applications?.length) return [];
  const jobIds = [...new Set(applications.map((application) => application.job_id))];
  const { data: jobs, error: jobsError } = await supabaseAdmin.from("recruiter_jobs")
    .select("id, company_name, title, location, status").in("id", jobIds);
  if (jobsError) throw new AppError(500, "DATABASE_ERROR", "Could not load application job details.");
  const jobById = new Map((jobs || []).map((job) => [job.id, job]));
  return applications.map((application) => ({ ...application, job: jobById.get(application.job_id) || null }));
}

export async function updateRecruiterApplication(recruiterId, applicationId, input) {
  const parsed = z.object({ status: z.enum(["reviewing", "accepted", "declined"]) }).strict().parse(input);
  const { data, error } = await supabaseAdmin.from("recruiter_job_applications")
    .update({ status: parsed.status }).eq("id", applicationId).eq("recruiter_id", recruiterId)
    .select("id, job_id, candidate_id, status, created_at").maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not update this application.");
  if (!data) throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found.");
  return data;
}

export async function listRecruiterShortlist(recruiterId) {
  const { data: rows, error } = await supabaseAdmin.from("recruiter_shortlists")
    .select("id, candidate_profile_id, created_at").eq("recruiter_id", recruiterId).order("created_at", { ascending: false });
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load shortlisted candidates.");
  return Promise.all((rows || []).map(async (row) => ({
    ...await getCandidateDetail(row.candidate_profile_id),
    shortlist_id: row.id,
    shortlisted_at: row.created_at,
  })));
}

export async function addRecruiterShortlist(recruiterId, candidateProfileId) {
  const { data: candidate, error: candidateError } = await supabaseAdmin.from("candidate_profiles")
    .select("id, user_id").eq("id", candidateProfileId).eq("is_current", true).maybeSingle();
  if (candidateError) throw new AppError(500, "DATABASE_ERROR", "Could not load this candidate.");
  if (!candidate) throw new AppError(404, "CANDIDATE_NOT_FOUND", "Candidate profile was not found.");
  const { data: profile, error: profileError } = await supabaseAdmin.from("profiles")
    .select("role").eq("id", candidate.user_id).maybeSingle();
  if (profileError) throw new AppError(500, "DATABASE_ERROR", "Could not load this candidate.");
  if (profile?.role !== "candidate") throw new AppError(404, "CANDIDATE_NOT_FOUND", "Candidate profile was not found.");
  const { data, error } = await supabaseAdmin.from("recruiter_shortlists")
    .insert({ recruiter_id: recruiterId, candidate_profile_id: candidateProfileId }).select("id").single();
  if (error?.code === "23505") throw new AppError(409, "ALREADY_SHORTLISTED", "This candidate is already shortlisted.");
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not shortlist this candidate.");
  return data;
}

export async function removeRecruiterShortlist(recruiterId, candidateProfileId) {
  const { data, error } = await supabaseAdmin.from("recruiter_shortlists").delete()
    .eq("recruiter_id", recruiterId).eq("candidate_profile_id", candidateProfileId).select("id").maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not remove this candidate from your shortlist.");
  if (!data) throw new AppError(404, "SHORTLIST_ENTRY_NOT_FOUND", "This candidate is not on your shortlist.");
  return { removed: true };
}

export async function listRecruiterInterviews(recruiterId) {
  const { data: interviews, error } = await supabaseAdmin.from("recruiter_interviews")
    .select("*").eq("recruiter_id", recruiterId).order("scheduled_at", { ascending: true });
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load interview schedules.");
  if (!interviews?.length) return [];
  const applicationIds = [...new Set(interviews.map((interview) => interview.application_id))];
  const { data: applications, error: applicationError } = await supabaseAdmin.from("recruiter_job_applications")
    .select("id, candidate_id, job_id").in("id", applicationIds).eq("recruiter_id", recruiterId);
  if (applicationError) throw new AppError(500, "DATABASE_ERROR", "Could not load interview candidates.");
  const candidateIds = [...new Set((applications || []).map((application) => application.candidate_id))];
  const jobIds = [...new Set((applications || []).map((application) => application.job_id))];
  const [{ data: profiles, error: profilesError }, { data: jobs, error: jobsError }] = await Promise.all([
    candidateIds.length ? supabaseAdmin.from("profiles").select("id, full_name").in("id", candidateIds) : Promise.resolve({ data: [], error: null }),
    jobIds.length ? supabaseAdmin.from("recruiter_jobs").select("id, title").in("id", jobIds).eq("recruiter_id", recruiterId) : Promise.resolve({ data: [], error: null }),
  ]);
  if (profilesError || jobsError) throw new AppError(500, "DATABASE_ERROR", "Could not load interview details.");
  const applicationById = new Map((applications || []).map((application) => [application.id, application]));
  const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const jobById = new Map((jobs || []).map((job) => [job.id, job]));
  return interviews.map((interview) => {
    const application = applicationById.get(interview.application_id);
    return {
      ...interview,
      candidate_name: profileById.get(application?.candidate_id)?.full_name || "Candidate",
      job_title: jobById.get(application?.job_id)?.title || "Job posting",
    };
  });
}

export async function scheduleRecruiterInterview(recruiterId, input) {
  const parsed = z.object({
    application_id: z.string().uuid(),
    scheduled_at: z.iso.datetime(),
    notes: z.string().trim().max(2000).optional().default(""),
  }).strict().parse(input);
  if (Date.parse(parsed.scheduled_at) <= Date.now()) {
    throw new AppError(422, "INVALID_INTERVIEW_TIME", "Choose an interview time in the future.");
  }
  const { data: application, error: applicationError } = await supabaseAdmin.from("recruiter_job_applications")
    .select("id, candidate_id, status").eq("id", parsed.application_id).eq("recruiter_id", recruiterId).maybeSingle();
  if (applicationError) throw new AppError(500, "DATABASE_ERROR", "Could not load this application.");
  if (!application) throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found.");
  if (!["reviewing", "accepted"].includes(application.status)) {
    throw new AppError(409, "APPLICATION_NOT_READY", "Review or accept this application before scheduling an interview.");
  }
  const { data: existing, error: existingError } = await supabaseAdmin.from("recruiter_interviews")
    .select("id, status").eq("application_id", parsed.application_id).eq("recruiter_id", recruiterId).maybeSingle();
  if (existingError) throw new AppError(500, "DATABASE_ERROR", "Could not check the interview schedule.");
  if (existing && existing.status !== "cancelled") {
    throw new AppError(409, "INTERVIEW_ALREADY_SCHEDULED", "An interview already exists for this application.");
  }
  const { data, error } = existing
    ? await supabaseAdmin.from("recruiter_interviews").update({
      scheduled_at: parsed.scheduled_at,
      notes: parsed.notes,
      status: "scheduled",
    }).eq("id", existing.id).eq("recruiter_id", recruiterId).select("*").single()
    : await supabaseAdmin.from("recruiter_interviews")
      .insert({ ...parsed, recruiter_id: recruiterId }).select("*").single();
  if (error?.code === "23505") throw new AppError(409, "INTERVIEW_ALREADY_SCHEDULED", "An interview already exists for this application.");
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not schedule this interview.");
  const notified = await notifyCandidate(
    application.candidate_id,
    "Recruiter interview scheduled",
    `An interview has been scheduled for ${new Date(parsed.scheduled_at).toISOString()}.`,
    data.id,
  );
  return notified ? data : { ...data, notification_warning: true };
}

export async function updateRecruiterInterview(recruiterId, interviewId, input) {
  const parsed = z.object({ status: z.enum(["completed", "cancelled"]) }).strict().parse(input);
  const { data, error } = await supabaseAdmin.from("recruiter_interviews")
    .update({ status: parsed.status }).eq("id", interviewId).eq("recruiter_id", recruiterId)
    .select("*").maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not update this interview.");
  if (!data) throw new AppError(404, "INTERVIEW_NOT_FOUND", "Interview not found.");
  if (parsed.status !== "cancelled") return data;
  const { data: application, error: applicationError } = await supabaseAdmin.from("recruiter_job_applications")
    .select("candidate_id").eq("id", data.application_id).eq("recruiter_id", recruiterId).maybeSingle();
  if (applicationError || !application) {
    logger.warn({ err: applicationError, interviewId: data.id }, "Interview was cancelled but candidate notification recipient could not be loaded");
    return { ...data, notification_warning: true };
  }
  const notified = await notifyCandidate(application.candidate_id, "Recruiter interview cancelled", "A recruiter has cancelled your scheduled interview.", data.id);
  return notified ? data : { ...data, notification_warning: true };
}
