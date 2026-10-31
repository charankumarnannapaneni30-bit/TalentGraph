import { z } from "zod";
import { supabaseAdmin } from "../utils/supabase.js";
import { AppError } from "../utils/errors.js";

const jobInputSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().min(10).max(8000),
  location: z.string().trim().max(200).nullable().optional(),
  job_type: z.enum(["full_time", "part_time", "internship", "contract"]).nullable().optional(),
}).strict();

const applicationInputSchema = z.object({
  message: z.string().trim().min(10).max(3000),
}).strict();

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
