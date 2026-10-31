import { supabaseAdmin } from "../utils/supabase.js";
import { AppError } from "../utils/errors.js";

export async function requireAuth(req, _res, next) {
  try {
    const header = req.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new AppError(401, "UNAUTHORIZED", "Sign in to continue.");
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) throw new AppError(401, "UNAUTHORIZED", "Your session is invalid or expired.");
    req.user = data.user;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAdmin(req, _res, next) {
  if (req.user?.app_metadata?.role !== "admin") {
    return next(new AppError(403, "FORBIDDEN", "Administrator access is required."));
  }
  return next();
}

export function requireRecruiter(req, _res, next) {
  if (req.user?.app_metadata?.role !== "recruiter") {
    return next(new AppError(403, "RECRUITER_ACCESS_REQUIRED", "An approved recruiter account is required."));
  }
  return next();
}

export function requireCandidate(req, _res, next) {
  if (req.user?.app_metadata?.role === "recruiter" || req.user?.app_metadata?.role === "admin") {
    return next(new AppError(403, "CANDIDATE_ACCESS_REQUIRED", "A candidate account is required."));
  }
  return next();
}

export async function requireConsent(req, _res, next) {
  try {
    const { data, error } = await supabaseAdmin.from("profiles")
      .select("consent_ai_processing")
      .eq("id", req.user.id)
      .maybeSingle();
    if (error) throw new AppError(500, "DATABASE_ERROR", "Could not verify AI-processing consent.");
    if (data?.consent_ai_processing !== true) {
      throw new AppError(403, "CONSENT_REQUIRED", "AI-processing consent is required before this operation.");
    }
    return next();
  } catch (error) {
    return next(error);
  }
}
