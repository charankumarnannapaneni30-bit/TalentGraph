import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUserById: vi.fn(),
  updateUserById: vi.fn(),
}));
vi.mock("../utils/supabase.js", () => ({
  supabaseAdmin: {
    from: mocks.from,
    auth: { admin: { getUserById: mocks.getUserById, updateUserById: mocks.updateUserById } },
  },
}));

import { revokeRecruiterAccess } from "./adminRecruiters.js";

function createTableQuery({ data = null, error = null } = {}) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    single: vi.fn().mockResolvedValue({ data, error }),
  };
  return query;
}

describe("revoke recruiter access", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.getUserById.mockReset();
    mocks.updateUserById.mockReset();
  });

  it("demotes an approved recruiter and closes open jobs", async () => {
    const request = { id: "request-1", user_id: "user-1", status: "approved" };
    const requestQuery = createTableQuery({ data: request });
    const profileQuery = createTableQuery();
    const jobsQuery = createTableQuery();
    const result = { ...request, status: "revoked" };
    const updateRequestQuery = createTableQuery({ data: result });
    const accessQueries = [requestQuery, updateRequestQuery];
    mocks.from.mockImplementation((table) => table === "recruiter_access_requests"
      ? accessQueries.shift()
      : table === "profiles" ? profileQuery : jobsQuery);
    mocks.getUserById.mockResolvedValue({
      data: { user: { app_metadata: { role: "recruiter", trusted: true }, user_metadata: { account_type: "recruiter" } } },
      error: null,
    });
    mocks.updateUserById.mockResolvedValue({ error: null });

    await expect(revokeRecruiterAccess("request-1")).resolves.toEqual(result);
    expect(mocks.updateUserById).toHaveBeenCalledWith("user-1", {
      app_metadata: { role: "candidate", trusted: true },
      user_metadata: { account_type: "candidate" },
    });
    expect(profileQuery.update).toHaveBeenCalledWith(expect.objectContaining({ role: "candidate", company_name: null }));
    expect(jobsQuery.update).toHaveBeenCalledWith({ status: "closed" });
    expect(updateRequestQuery.update).toHaveBeenCalledWith({ status: "revoked" });
  });

  it("does not revoke a pending request", async () => {
    const requestQuery = createTableQuery({ data: { id: "request-1", status: "pending" } });
    mocks.from.mockReturnValue(requestQuery);

    await expect(revokeRecruiterAccess("request-1")).rejects.toMatchObject({
      status: 409,
      code: "REQUEST_NOT_APPROVED",
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("does not revoke administrator access", async () => {
    const requestQuery = createTableQuery({ data: { id: "request-1", user_id: "admin-1", status: "approved" } });
    mocks.from.mockReturnValue(requestQuery);
    mocks.getUserById.mockResolvedValue({
      data: { user: { app_metadata: { role: "admin" }, user_metadata: {} } },
      error: null,
    });

    await expect(revokeRecruiterAccess("request-1")).rejects.toMatchObject({
      status: 409,
      code: "ROLE_CONFLICT",
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });
});
