import { describe, expect, it, vi } from "vitest";

vi.mock("../utils/supabase.js", () => ({ supabaseAdmin: {} }));

import { requireCandidate, requireRecruiter } from "./auth.js";

describe("role authorization", () => {
  it("does not grant recruiter access from user-editable metadata", () => {
    const next = vi.fn();
    requireRecruiter({ user: { user_metadata: { role: "recruiter" } } }, null, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403, code: "RECRUITER_ACCESS_REQUIRED" }));
  });

  it("allows recruiter access only from app metadata", () => {
    const next = vi.fn();
    requireRecruiter({ user: { app_metadata: { role: "recruiter" } } }, null, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("blocks recruiter accounts from candidate-only routes", () => {
    const next = vi.fn();
    requireCandidate({ user: { app_metadata: { role: "recruiter" } } }, null, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403, code: "CANDIDATE_ACCESS_REQUIRED" }));
  });
});
