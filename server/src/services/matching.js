import {
  EVIDENCE_MULTIPLIER,
  MATCH_WEIGHTS,
  MIN_SCORE_TO_RECOMMEND,
  SKILL_LEVEL_VALUE,
} from "../config/advisory.js";
import { canonicalSkill } from "../config/skillSynonyms.js";

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function deadlinePassed(deadline) {
  return Boolean(deadline && String(deadline).slice(0, 10) < new Date().toISOString().slice(0, 10));
}

function getSkill(profileSkills, name) {
  const target = canonicalSkill(name);
  return profileSkills.find((skill) => canonicalSkill(skill.normalized_name || skill.name) === target);
}

function skillCredit(skill) {
  if (!skill) return 0;
  const level = SKILL_LEVEL_VALUE[skill.level] ?? 0;
  const evidence = EVIDENCE_MULTIPLIER[skill.evidence_strength] ?? EVIDENCE_MULTIPLIER.none;
  return level * evidence;
}

function educationScore(profile, job) {
  if (!job.education_requirement) return 1;
  const candidate = String(profile.highest_education || "").toLowerCase();
  const requirement = String(job.education_requirement).toLowerCase();
  if (!candidate) return 0.2;
  if (candidate.includes(requirement) || requirement.includes(candidate)) return 1;
  const levels = ["high school", "secondary", "diploma", "associate", "bachelor", "master", "doctorate", "phd"];
  const candidateLevel = levels.findIndex((level) => candidate.includes(level));
  const requiredLevel = levels.findIndex((level) => requirement.includes(level));
  if (candidateLevel >= 0 && requiredLevel >= 0 && candidateLevel >= requiredLevel) return 1;
  return candidateLevel >= 0 && requiredLevel >= 0 && candidateLevel === requiredLevel - 1 ? 0.5 : 0.2;
}

function experienceScore(months, min, max) {
  const candidate = Math.max(0, Number(months) || 0);
  const lower = Math.max(0, Number(min) || 0);
  if (candidate < lower) return clamp(0.2 + 0.8 * (candidate / Math.max(lower, 1)));
  if (max != null && candidate > max) return clamp(1 - 0.3 * ((candidate - max) / Math.max(max, 1)), 0.7, 1);
  return 1;
}

function preferenceScore(job, preferences) {
  const checks = [];
  const locations = preferences.preferred_locations || [];
  if (locations.length) {
    const location = String(job.location || "").toLowerCase();
    checks.push((preferences.open_to_remote && job.is_remote) || locations.some((item) => location.includes(item.toLowerCase())) ? 1 : 0);
  } else {
    checks.push(preferences.open_to_remote || !job.is_remote ? 1 : 0.5);
  }
  if (preferences.job_types?.length) checks.push(preferences.job_types.includes(job.job_type) ? 1 : 0.5);
  if (preferences.min_salary && job.salary_max) checks.push(job.salary_max >= preferences.min_salary ? 1 : 0.5);
  return checks.length ? checks.reduce((sum, item) => sum + item, 0) / checks.length : 1;
}

export function matchJob(profile, job, preferences = {}) {
  const excluded = (preferences.excluded_companies || []).some(
    (company) => company.trim().toLowerCase() === String(job.company_name || "").trim().toLowerCase(),
  );
  if (excluded || job.status !== "open" || deadlinePassed(job.application_deadline)) return null;

  const skills = profile.skills || [];
  const required = job.required_skills || [];
  const preferred = job.preferred_skills || [];
  let skillWeight = 0;
  let skillTotal = 0;
  const matchedSkills = [];
  const missingSkills = [];

  for (const name of required) {
    const item = getSkill(skills, name);
    skillTotal += skillCredit(item);
    skillWeight += 1;
    if (item && skillCredit(item) > 0) matchedSkills.push(name);
    else missingSkills.push(name);
  }
  for (const name of preferred) {
    const item = getSkill(skills, name);
    skillTotal += 0.4 * skillCredit(item);
    skillWeight += 0.4;
  }
  const skillsScore = skillWeight ? skillTotal / skillWeight : 1;

  const projectSkills = new Set((profile.projects || []).flatMap((project) => project.technologies || []).map(canonicalSkill));
  const projectsScore = required.length ? required.filter((skill) => projectSkills.has(canonicalSkill(skill))).length / required.length : 1;
  const education = educationScore(profile, job);
  const experience = experienceScore(profile.total_experience_months, job.min_experience_months, job.max_experience_months);
  const preferencesScore = preferenceScore(job, preferences);
  const eligibilityFlags = [];
  const constraints = job.eligibility_constraints || [];
  const eligibility = constraints.length ? clamp(1 - constraints.length * 0.15, 0.2, 1) : 1;
  for (const constraint of constraints) eligibilityFlags.push({ constraint, status: "check_required" });

  const breakdown = {
    skills: Math.round(skillsScore * 100),
    projects: Math.round(projectsScore * 100),
    education: Math.round(education * 100),
    experience: Math.round(experience * 100),
    preferences: Math.round(preferencesScore * 100),
    eligibility: Math.round(eligibility * 100),
  };
  const compatibilityScore = Math.round(100 * (
    MATCH_WEIGHTS.skills * skillsScore +
    MATCH_WEIGHTS.projects * projectsScore +
    MATCH_WEIGHTS.education * education +
    MATCH_WEIGHTS.experience * experience +
    MATCH_WEIGHTS.preferences * preferencesScore +
    MATCH_WEIGHTS.eligibility * eligibility
  ));

  if (compatibilityScore < MIN_SCORE_TO_RECOMMEND) return null;
  return {
    compatibility_score: compatibilityScore,
    score_breakdown: breakdown,
    matched_skills: matchedSkills,
    missing_skills: missingSkills,
    eligibility_flags: eligibilityFlags,
  };
}

export { educationScore, experienceScore, preferenceScore, skillCredit };
