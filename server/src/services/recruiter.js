import { z } from "zod";
import { supabaseAdmin } from "../utils/supabase.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

// Fallback in-memory store if the migration table has not yet been migrated to the database.
const fallbackInquiries = new Map();

export const inquiryInputSchema = z.object({
  candidate_id: z.string().uuid(),
  role_title: z.string().trim().min(2).max(150),
  company_name: z.string().trim().min(1).max(200),
  message: z.string().trim().min(10).max(3000),
  recruiter_contact: z.object({
    email: z.string().email().optional(),
    phone: z.string().trim().max(40).optional(),
    linkedin: z.string().trim().max(200).optional(),
  }).optional().default({}),
}).strict();

export const inquiryResponseSchema = z.object({
  status: z.enum(["accepted", "declined"]),
  candidate_response: z.string().trim().max(3000).optional(),
}).strict();

export async function searchCandidates({
  search = "",
  skill = "",
  minExperience = 0,
  highestEducation = "",
  limit = 50,
} = {}) {
  // Query current candidate profiles
  let query = supabaseAdmin
    .from("candidate_profiles")
    .select("id, user_id, summary, skills, strengths, specializations, total_experience_months, highest_education, projects, education, certifications, created_at")
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (minExperience > 0) {
    query = query.gte("total_experience_months", minExperience);
  }

  const { data: candidates, error } = await query;
  if (error) {
    logger.error({ err: error }, "Failed to fetch candidate profiles");
    throw new AppError(500, "DATABASE_ERROR", "Could not fetch candidate profiles.");
  }

  // Fetch full names from profiles
  const userIds = [...new Set((candidates || []).map((c) => c.user_id))];
  let profileMap = new Map();
  if (userIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, role, company_name")
      .in("id", userIds);
    (profiles || []).forEach((p) => profileMap.set(p.id, p));
  }

  const normalizedSearch = search.trim().toLowerCase();
  const normalizedSkill = skill.trim().toLowerCase();
  const normalizedEducation = highestEducation.trim().toLowerCase();

  return (candidates || [])
    .map((candidate) => {
      const profile = profileMap.get(candidate.user_id);
      return {
        id: candidate.id,
        user_id: candidate.user_id,
        full_name: profile?.full_name || "Anonymous Candidate",
        summary: candidate.summary || "Evidence-backed profile ready for opportunities.",
        highest_education: candidate.highest_education || "Not specified",
        total_experience_months: candidate.total_experience_months || 0,
        specializations: candidate.specializations || [],
        skills: (candidate.skills || []).map((s) => ({
          name: s.name,
          level: s.level,
          evidence_strength: s.evidence_strength,
        })),
        strengths: candidate.strengths || [],
        projects: (candidate.projects || []).map((p) => ({
          title: p.title || p.name || "Project",
          description: p.description || p.summary || "",
        })),
        created_at: candidate.created_at,
      };
    })
    .filter((candidate) => {
      if (normalizedEducation && !candidate.highest_education.toLowerCase().includes(normalizedEducation)) {
        return false;
      }
      if (normalizedSkill) {
        const hasSkill = candidate.skills.some((s) => s.name?.toLowerCase().includes(normalizedSkill));
        if (!hasSkill) return false;
      }
      if (normalizedSearch) {
        const inName = candidate.full_name.toLowerCase().includes(normalizedSearch);
        const inSummary = candidate.summary.toLowerCase().includes(normalizedSearch);
        const inSkills = candidate.skills.some((s) => s.name?.toLowerCase().includes(normalizedSearch));
        const inSpecs = candidate.specializations.some((spec) => spec.toLowerCase().includes(normalizedSearch));
        if (!inName && !inSummary && !inSkills && !inSpecs) return false;
      }
      return true;
    });
}

export async function getCandidateDetail(candidateId) {
  const { data: candidate, error } = await supabaseAdmin
    .from("candidate_profiles")
    .select("*")
    .eq("id", candidateId)
    .maybeSingle();

  if (error || !candidate) {
    throw new AppError(404, "NOT_FOUND", "Candidate profile not found.");
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("full_name, role, company_name")
    .eq("id", candidate.user_id)
    .maybeSingle();

  return {
    ...candidate,
    full_name: profile?.full_name || "Anonymous Candidate",
  };
}

export async function sendRecruiterInquiry(recruiterUser, input) {
  const parsed = inquiryInputSchema.parse(input);

  // Check candidate profile
  const { data: candidate, error: candidateError } = await supabaseAdmin
    .from("candidate_profiles")
    .select("id, user_id")
    .eq("id", parsed.candidate_id)
    .maybeSingle();

  if (candidateError || !candidate) {
    throw new AppError(404, "CANDIDATE_NOT_FOUND", "Candidate profile was not found.");
  }

  const recruiterName = recruiterUser.user_metadata?.full_name || recruiterUser.email?.split("@")[0] || "A Recruiter";
  const contact = {
    email: parsed.recruiter_contact?.email || recruiterUser.email || "",
    phone: parsed.recruiter_contact?.phone || "",
    linkedin: parsed.recruiter_contact?.linkedin || "",
  };

  const newInquiry = {
    recruiter_id: recruiterUser.id,
    candidate_id: candidate.user_id,
    role_title: parsed.role_title,
    company_name: parsed.company_name,
    message: parsed.message,
    recruiter_contact: contact,
    status: "pending",
  };

  let saved;
  try {
    const { data, error } = await supabaseAdmin
      .from("recruiter_inquiries")
      .insert(newInquiry)
      .select("*")
      .single();

    if (error) {
      logger.warn({ err: error }, "Failed to insert into recruiter_inquiries table; using fallback store");
      saved = {
        id: crypto.randomUUID(),
        ...newInquiry,
        candidate_response: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      fallbackInquiries.set(saved.id, saved);
    } else {
      saved = data;
    }
  } catch (err) {
    logger.warn({ err }, "Exception querying recruiter_inquiries; using fallback store");
    saved = {
      id: crypto.randomUUID(),
      ...newInquiry,
      candidate_response: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    fallbackInquiries.set(saved.id, saved);
  }

  // Notify the candidate in the app
  try {
    await supabaseAdmin.from("notifications").insert({
      user_id: candidate.user_id,
      type: "system",
      title: `Recruiter inquiry from ${parsed.company_name}`,
      body: `${recruiterName} from ${parsed.company_name} reached out regarding the "${parsed.role_title}" role.`,
      is_read: false,
    });
  } catch (notifError) {
    logger.warn({ err: notifError }, "Could not send notification to candidate for inquiry");
  }

  return saved;
}

export async function listRecruiterInquiries(recruiterId) {
  let list = [];
  try {
    const { data, error } = await supabaseAdmin
      .from("recruiter_inquiries")
      .select("*")
      .eq("recruiter_id", recruiterId)
      .order("created_at", { ascending: false });

    if (!error && Array.isArray(data)) {
      list = data;
    }
  } catch (err) {
    logger.warn({ err }, "Exception reading recruiter_inquiries");
  }

  // Include in-memory fallbacks
  for (const item of fallbackInquiries.values()) {
    if (item.recruiter_id === recruiterId && !list.some((existing) => existing.id === item.id)) {
      list.push(item);
    }
  }

  // Resolve candidate details
  const candidateUserIds = [...new Set(list.map((i) => i.candidate_id))];
  if (candidateUserIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name")
      .in("id", candidateUserIds);
    const map = new Map((profiles || []).map((p) => [p.id, p.full_name]));
    list = list.map((item) => ({
      ...item,
      candidate_name: map.get(item.candidate_id) || "Candidate",
    }));
  }

  return list;
}

export async function listCandidateInquiries(candidateUserId) {
  let list = [];
  try {
    const { data, error } = await supabaseAdmin
      .from("recruiter_inquiries")
      .select("*")
      .eq("candidate_id", candidateUserId)
      .order("created_at", { ascending: false });

    if (!error && Array.isArray(data)) {
      list = data;
    }
  } catch (err) {
    logger.warn({ err }, "Exception reading candidate inquiries");
  }

  // Include in-memory fallbacks
  for (const item of fallbackInquiries.values()) {
    if (item.candidate_id === candidateUserId && !list.some((existing) => existing.id === item.id)) {
      list.push(item);
    }
  }

  return list;
}

export async function respondToInquiry(candidateUserId, inquiryId, input) {
  const parsed = inquiryResponseSchema.parse(input);

  let updated;
  try {
    const { data, error } = await supabaseAdmin
      .from("recruiter_inquiries")
      .update({
        status: parsed.status,
        candidate_response: parsed.candidate_response || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", inquiryId)
      .eq("candidate_id", candidateUserId)
      .select("*")
      .single();

    if (!error && data) {
      updated = data;
    }
  } catch (err) {
    logger.warn({ err }, "Could not update recruiter_inquiries table; checking fallback");
  }

  if (!updated && fallbackInquiries.has(inquiryId)) {
    const item = fallbackInquiries.get(inquiryId);
    if (item.candidate_id === candidateUserId) {
      item.status = parsed.status;
      item.candidate_response = parsed.candidate_response || null;
      item.updated_at = new Date().toISOString();
      updated = item;
    }
  }

  if (!updated) {
    throw new AppError(404, "INQUIRY_NOT_FOUND", "Inquiry not found or access denied.");
  }

  // Notify recruiter of candidate response
  try {
    const { data: candidateProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", candidateUserId)
      .maybeSingle();

    const candidateName = candidateProfile?.full_name || "A candidate";
    await supabaseAdmin.from("notifications").insert({
      user_id: updated.recruiter_id,
      type: "system",
      title: `Candidate ${parsed.status === "accepted" ? "accepted" : "declined"} your inquiry`,
      body: `${candidateName} has ${parsed.status} your outreach for the "${updated.role_title}" role.`,
      is_read: false,
    });
  } catch (notifErr) {
    logger.warn({ err: notifErr }, "Could not notify recruiter about inquiry response");
  }

  return updated;
}

