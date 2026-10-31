import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../utils/supabase.js", () => ({ supabaseAdmin: { from: mocks.from } }));

import { createRecruiterJob, updateRecruiterApplication } from "./recruiterJobs.js";

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
});
