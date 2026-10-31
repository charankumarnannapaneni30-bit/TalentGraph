import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../utils/supabase.js", () => ({ supabaseAdmin: { from: mocks.from } }));

import { createRecruiterJob, scheduleRecruiterInterview, updateRecruiterApplication, updateRecruiterJob } from "./recruiterJobs.js";

beforeEach(() => mocks.from.mockReset());

describe("recruiter job service", () => {
  it("uses the approved company profile when creating a job", async () => {
    const insert = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const single = vi.fn().mockResolvedValue({ data: { id: "job-1", company_name: "Acme" }, error: null });
    const profileQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { company_name: "Acme" }, error: null }),
    };
    mocks.from.mockImplementation((table) => table === "profiles"
      ? profileQuery
      : { insert, select, single });

    await createRecruiterJob("recruiter-1", { title: "Engineer", description: "Build reliable services." });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      recruiter_id: "recruiter-1",
      company_name: "Acme",
      title: "Engineer",
    }));
  });

  it("scopes application status updates to the owning recruiter", async () => {
    const update = vi.fn().mockReturnThis();
    const eq = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "application-1", status: "accepted" }, error: null });
    mocks.from.mockReturnValue({ update, eq, select, maybeSingle });

    await updateRecruiterApplication("recruiter-1", "application-1", { status: "accepted" });

    expect(eq).toHaveBeenNthCalledWith(1, "id", "application-1");
    expect(eq).toHaveBeenNthCalledWith(2, "recruiter_id", "recruiter-1");
  });

  it("scopes job status updates to the owning recruiter", async () => {
    const update = vi.fn().mockReturnThis();
    const eq = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "job-id", status: "closed" }, error: null });
    mocks.from.mockReturnValue({ update, eq, select, maybeSingle });

    await updateRecruiterJob("recruiter-id", "job-id", { status: "closed" });

    expect(eq).toHaveBeenNthCalledWith(1, "id", "job-id");
    expect(eq).toHaveBeenNthCalledWith(2, "recruiter_id", "recruiter-id");
  });

  it("does not schedule interviews before an application is reviewed", async () => {
    const applicationQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { status: "pending" }, error: null }),
    };
    mocks.from.mockReturnValue(applicationQuery);

    await expect(scheduleRecruiterInterview("recruiter-id", {
      application_id: "00000000-0000-4000-8000-000000000001",
      scheduled_at: new Date(Date.now() + 60_000).toISOString(),
    })).rejects.toMatchObject({ status: 409, code: "APPLICATION_NOT_READY" });
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
});
