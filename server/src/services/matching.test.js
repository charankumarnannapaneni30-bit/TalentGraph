import { describe, expect, it } from "vitest";
import { matchJob, experienceScore, skillCredit } from "./matching.js";

const profile = {
  skills: [
    { name: "ReactJS", normalized_name: "react", level: "strong", evidence_strength: "strong" },
    { name: "TypeScript", level: "intermediate", evidence_strength: "moderate" },
  ],
  projects: [{ technologies: ["React", "TypeScript"] }],
  highest_education: "Bachelor's degree",
  total_experience_months: 24,
};
const baseJob = {
  status: "open",
  company_name: "Example",
  required_skills: ["React"],
  preferred_skills: [],
  min_experience_months: 12,
  education_requirement: "Bachelor",
  eligibility_constraints: [],
};

describe("deterministic job matching", () => {
  it("uses configured skill and evidence multipliers", () => {
    expect(skillCredit(profile.skills[0])).toBe(1);
    expect(skillCredit(profile.skills[1])).toBeCloseTo(0.595);
  });
  it("returns a deterministic score breakdown for a matching role", () => {
    const result = matchJob(profile, baseJob);
    expect(result).not.toBeNull();
    expect(result.compatibility_score).toBeGreaterThanOrEqual(40);
    expect(result.score_breakdown).toEqual({ skills: 100, projects: 100, education: 100, experience: 100, preferences: 100, eligibility: 100 });
  });
  it("matches normalized skill aliases", () => {
    expect(matchJob(profile, { ...baseJob, required_skills: ["React.js"] })?.matched_skills).toEqual(["React.js"]);
  });
  it("lists absent requirements as gaps", () => {
    expect(matchJob(profile, { ...baseJob, required_skills: ["React", "Rust"] })?.missing_skills).toEqual(["Rust"]);
  });
  it("does not recommend closed jobs", () => {
    expect(matchJob(profile, { ...baseJob, status: "closed" })).toBeNull();
  });
  it("does not recommend expired jobs", () => {
    expect(matchJob(profile, { ...baseJob, application_deadline: "2000-01-01" })).toBeNull();
  });
  it("keeps a job open through its stated deadline date", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(matchJob(profile, { ...baseJob, application_deadline: today })).not.toBeNull();
  });
  it("excludes companies requested by the user", () => {
    expect(matchJob(profile, baseJob, { excluded_companies: ["example"] })).toBeNull();
  });
  it("scores experience below the minimum with a floor", () => {
    expect(experienceScore(0, 24)).toBe(0.2);
    expect(experienceScore(12, 24)).toBeCloseTo(0.6);
  });
  it("scores experience inside the range fully", () => {
    expect(experienceScore(36, 12, 48)).toBe(1);
  });
  it("gives a slight preference credit to above-range experience", () => {
    expect(experienceScore(60, 12, 48)).toBeGreaterThanOrEqual(0.7);
    expect(experienceScore(60, 12, 48)).toBeLessThan(1);
  });
  it("reports eligibility requirements as checks rather than assumptions", () => {
    const result = matchJob(profile, { ...baseJob, eligibility_constraints: ["Work authorization"] });
    expect(result.eligibility_flags).toEqual([{ constraint: "Work authorization", status: "check_required" }]);
  });
  it("handles a job with no explicit skill requirements", () => {
    expect(matchJob(profile, { ...baseJob, required_skills: [] })?.score_breakdown.skills).toBe(100);
  });
});
