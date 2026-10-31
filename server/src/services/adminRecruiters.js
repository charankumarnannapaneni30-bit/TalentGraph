import { supabaseAdmin } from "../utils/supabase.js";
import { AppError } from "../utils/errors.js";

export async function revokeRecruiterAccess(requestId) {
  const { data: request, error: requestError } = await supabaseAdmin.from("recruiter_access_requests")
    .select("*").eq("id", requestId).maybeSingle();
  if (requestError) throw new AppError(500, "DATABASE_ERROR", "Could not load this recruiter request.");
  if (!request) throw new AppError(404, "NOT_FOUND", "Recruiter request not found.");
  if (!["approved", "revoked"].includes(request.status)) {
    throw new AppError(409, "REQUEST_NOT_APPROVED", "Only an approved recruiter can have access revoked.");
  }

  const { data: userResult, error: userError } = await supabaseAdmin.auth.admin.getUserById(request.user_id);
  if (userError || !userResult.user) throw new AppError(500, "AUTH_USER_LOOKUP_FAILED", "Could not load the recruiter account.");
  const user = userResult.user;
  if (user.app_metadata?.role === "admin") {
    throw new AppError(409, "ROLE_CONFLICT", "Administrator access cannot be revoked from this page.");
  }

  const { error: roleError } = await supabaseAdmin.auth.admin.updateUserById(request.user_id, {
    app_metadata: { ...user.app_metadata, role: "candidate" },
    user_metadata: { ...user.user_metadata, account_type: "candidate" },
  });
  if (roleError) throw new AppError(500, "RECRUITER_REVOCATION_FAILED", "Could not revoke recruiter access.");

  const { error: profileError } = await supabaseAdmin.from("profiles")
    .update({ role: "candidate", company_name: null, updated_at: new Date().toISOString() })
    .eq("id", request.user_id);
  if (profileError) throw new AppError(500, "DATABASE_ERROR", "Recruiter access was disabled, but the account profile could not be updated.");

  const { error: jobsError } = await supabaseAdmin.from("recruiter_jobs")
    .update({ status: "closed" }).eq("recruiter_id", request.user_id).eq("status", "open");
  if (jobsError) throw new AppError(500, "DATABASE_ERROR", "Recruiter access was disabled, but open job postings could not be closed.");

  const { data: updatedRequest, error: updateError } = await supabaseAdmin.from("recruiter_access_requests")
    .update({ status: "revoked" }).eq("id", requestId).select("id, user_id, email, company_name, status").single();
  if (updateError) throw new AppError(500, "DATABASE_ERROR", "Recruiter access was disabled, but the request status could not be updated.");
  return updatedRequest;
}
