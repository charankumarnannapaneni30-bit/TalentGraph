import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  sendEmail: vi.fn(),
}));
vi.mock("../utils/supabase.js", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("./notificationEmails.js", () => ({ sendJobMatchNotificationEmail: mocks.sendEmail }));

import { refreshRecruiterJobMatches } from "./recruiterMatching.js";

function createQuery(table, state) {
  const query = {
    action: "select",
    filters: {},
    select() { return this; },
    eq(field, value) { this.filters[field] = value; return this; },
    in(field, value) { this.filters[field] = value; return this; },
    order() { return this; },
    maybeSingle() {
      return Promise.resolve({ data: table === "recruiter_jobs" ? state.job : null, error: null });
    },
    upsert(rows) {
      state.savedMatches = rows;
      return Promise.resolve({ error: null });
    },
    insert(rows) {
      state.notifications = rows;
      return Promise.resolve({ error: null });
    },
    update(values) {
      state.matchUpdate = values;
      return this;
    },
    delete() {
      state.deletedMatches = true;
      return this;
    },
    then(resolve, reject) {
      let data = [];
      if (table === "candidate_profiles") data = state.candidates;
      if (table === "profiles") data = state.accounts;
      if (table === "preferences") data = state.preferences;
      if (table === "recruiter_job_matches") data = state.existingMatches || [];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return query;
}

describe("recruiter job matching", () => {
  let state;
  beforeEach(() => {
    state = {
      job: {
        id: "recruiter-job-1",
        title: "React Engineer",
        company_name: "Acme",
        status: "open",
        required_skills: ["React"],
        preferred_skills: [],
        min_experience_months: 0,
      },
      candidates: [{
        id: "candidate-profile-1",
        user_id: "candidate-1",
        skills: [{ name: "React", level: "strong", evidence_strength: "strong" }],
        projects: [{ technologies: ["React"] }],
        highest_education: "bachelor",
        total_experience_months: 0,
      }],
      accounts: [{ id: "candidate-1", role: "candidate", consent_ai_processing: true }],
      preferences: [{ user_id: "candidate-1", notify_new_matches: true, notify_min_score: 65 }],
      existingMatches: [],
      savedMatches: [],
      notifications: [],
      matchUpdate: null,
    };
    mocks.from.mockImplementation((table) => createQuery(table, state));
    mocks.sendEmail.mockReset().mockResolvedValue(undefined);
  });

  it("saves a skill match and notifies the eligible candidate", async () => {
    const matches = await refreshRecruiterJobMatches("recruiter-job-1");

    expect(matches).toHaveLength(1);
    expect(state.savedMatches[0]).toMatchObject({
      candidate_id: "candidate-1",
      recruiter_job_id: "recruiter-job-1",
      matched_skills: ["React"],
      compatibility_score: expect.any(Number),
      notified: false,
    });
    expect(state.notifications).toEqual([expect.objectContaining({
      user_id: "candidate-1",
      type: "new_match",
      recruiter_job_id: "recruiter-job-1",
    })]);
    expect(state.matchUpdate).toEqual({ notified: true });
    expect(mocks.sendEmail).toHaveBeenCalledWith("candidate-1", state.notifications);
  });

  it("does not match or notify candidates without AI-processing consent", async () => {
    state.accounts[0].consent_ai_processing = false;

    await refreshRecruiterJobMatches("recruiter-job-1");

    expect(state.savedMatches).toEqual([]);
    expect(state.notifications).toEqual([]);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("does not notify below a candidate's configured match threshold", async () => {
    state.preferences[0].notify_min_score = 101;

    await refreshRecruiterJobMatches("recruiter-job-1");

    expect(state.savedMatches).toHaveLength(1);
    expect(state.notifications).toEqual([]);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
