import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  adminUpdateUserById: vi.fn(),
}));

vi.mock("../utils/supabase.js", () => ({
  supabaseAdmin: {
    from: mocks.from,
    auth: { admin: { updateUserById: mocks.adminUpdateUserById } },
  },
}));
vi.mock("../utils/logger.js", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

import {
  searchCandidates,
  getCandidateDetail,
  sendRecruiterInquiry,
  listRecruiterInquiries,
  listCandidateInquiries,
  respondToInquiry,
} from "./recruiter.js";

beforeEach(() => {
  mocks.from.mockReset();
  mocks.adminUpdateUserById.mockReset();
});

describe("recruiter service", () => {
  it("filters candidates by skill and keyword", async () => {
    const candidates = [
      {
        id: "cand-1",
        user_id: "user-1",
        summary: "Full stack engineer",
        skills: [{ name: "React", level: "strong", evidence_strength: "high" }],
        highest_education: "Bachelor of Science",
        total_experience_months: 24,
        specializations: ["Web development"],
        projects: [{ title: "App 1" }],
        created_at: "2026-01-01",
      },
      {
        id: "cand-2",
        user_id: "user-2",
        summary: "Data scientist",
        skills: [{ name: "Python", level: "strong", evidence_strength: "high" }],
        highest_education: "Master of Science",
        total_experience_months: 36,
        specializations: ["Machine Learning"],
        projects: [{ title: "Model 1" }],
        created_at: "2026-01-02",
      },
      {
        id: "cand-3",
        user_id: "user-3",
        summary: "Recruiter profile with React experience",
        skills: [{ name: "React", level: "strong", evidence_strength: "high" }],
        highest_education: "Bachelor of Science",
        total_experience_months: 48,
        specializations: ["Hiring"],
        projects: [],
        created_at: "2026-01-03",
      },
    ];

    const queryMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: candidates, error: null }),
    };

    mocks.from.mockImplementation((table) => {
      if (table === "candidate_profiles") return queryMock;
      if (table === "profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({
            data: [
              { id: "user-1", full_name: "Alice Dev", role: "candidate" },
              { id: "user-2", full_name: "Bob Data", role: "candidate" },
              { id: "user-3", full_name: "Recruiter", role: "recruiter" },
            ],
          }),
        };
      }
      return queryMock;
    });

    const reactResults = await searchCandidates({ skill: "React" });
    expect(reactResults).toHaveLength(1);
    expect(reactResults[0].full_name).toBe("Alice Dev");

    const searchResults = await searchCandidates({ search: "Data" });
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0].full_name).toBe("Bob Data");
  });

  it("sends an inquiry to a candidate and triggers a notification", async () => {
    const candidateUuid = crypto.randomUUID();
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: "inq-123",
            recruiter_id: "recruiter-1",
            candidate_id: "cand-user-1",
            role_title: "Senior Frontend Engineer",
            company_name: "Acme Tech",
            message: "We love your React projects and would like to talk.",
            status: "pending",
          },
          error: null,
        }),
      }),
    });

    const notifInsert = vi.fn().mockResolvedValue({ data: null, error: null });

    mocks.from.mockImplementation((table) => {
      if (table === "candidate_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: candidateUuid, user_id: "cand-user-1" },
            error: null,
          }),
        };
      }
      if (table === "recruiter_inquiries") {
        return { insert: insertMock };
      }
      if (table === "notifications") {
        return { insert: notifInsert };
      }
      return {};
    });

    const inquiry = await sendRecruiterInquiry(
      { id: "recruiter-1", email: "recruiter@acme.com", user_metadata: { full_name: "Jane Recruiter" } },
      {
        candidate_id: candidateUuid,
        role_title: "Senior Frontend Engineer",
        company_name: "Acme Tech",
        message: "We love your React projects and would like to talk.",
        recruiter_contact: { email: "recruiter@acme.com" },
      }
    );

    expect(inquiry.id).toBe("inq-123");
    expect(insertMock).toHaveBeenCalled();
    expect(notifInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "cand-user-1",
        title: expect.stringContaining("Acme Tech"),
      })
    );
  });

  it("retrieves candidate details and lists inquiries", async () => {
    mocks.from.mockImplementation((table) => {
      if (table === "candidate_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "cand-1", user_id: "user-1", summary: "Great engineer" },
            error: null,
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { full_name: "John Doe", role: "candidate" }, error: null }),
        };
      }
      if (table === "recruiter_inquiries") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: "inq-1",
                recruiter_id: "recruiter-1",
                candidate_id: "user-1",
                role_title: "Tech Lead",
                status: "pending",
              },
            ],
            error: null,
          }),
        };
      }
      return {};
    });

    const detail = await getCandidateDetail("cand-1");
    expect(detail.full_name).toBe("John Doe");

    const recruiterInquiries = await listRecruiterInquiries("recruiter-1");
    expect(recruiterInquiries).toHaveLength(1);

    const candidateInquiries = await listCandidateInquiries("user-1");
    expect(candidateInquiries).toHaveLength(1);
  });

  it("allows a candidate to accept an inquiry and notifies the recruiter", async () => {
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: "inq-123",
            recruiter_id: "recruiter-1",
            candidate_id: "cand-user-1",
            role_title: "Frontend Engineer",
            status: "accepted",
            candidate_response: "Happy to connect! My email is candidate@example.com",
          },
          error: null,
        }),
      }),
    });

    const notifInsert = vi.fn().mockResolvedValue({ data: null, error: null });

    mocks.from.mockImplementation((table) => {
      if (table === "recruiter_inquiries") return { update: updateMock };
      if (table === "notifications") return { insert: notifInsert };
      if (table === "profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { full_name: "John Doe" }, error: null }),
        };
      }
      return {};
    });

    const result = await respondToInquiry("cand-user-1", "inq-123", {
      status: "accepted",
      candidate_response: "Happy to connect! My email is candidate@example.com",
    });

    expect(result.status).toBe("accepted");
    expect(notifInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "recruiter-1",
        title: expect.stringContaining("accepted"),
      })
    );
  });
});
