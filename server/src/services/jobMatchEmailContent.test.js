import { describe, expect, it } from "vitest";
import { buildJobMatchEmail } from "./jobMatchEmailContent.js";

describe("job match email content", () => {
  it("links to the matching job and escapes notification content", () => {
    const email = buildJobMatchEmail([{
      type: "new_match",
      title: "<Engineer>",
      body: "A & B",
      job_id: "job-123",
    }], "https://talentgraph.example");

    expect(email.subject).toBe("New job matches are ready");
    expect(email.text).toContain("https://talentgraph.example/app/jobs/job-123");
    expect(email.html).toContain("&lt;Engineer&gt;");
    expect(email.html).toContain("A &amp; B");
    expect(email.html).not.toContain("<Engineer>");
  });

  it("uses a reopened-job subject when all alerts are reopened jobs", () => {
    const email = buildJobMatchEmail([{
      type: "job_reopened",
      title: "A matched job has reopened",
      body: "A previously closed vacancy is open again.",
      job_id: "job-456",
    }], "https://talentgraph.example");

    expect(email.subject).toBe("A matched job has reopened");
  });

  it("links recruiter job alerts to the candidate job matches page", () => {
    const email = buildJobMatchEmail([{
      type: "new_match",
      title: "A new recruiter job matches your profile",
      body: "Engineer at Acme matches your skills.",
      recruiter_job_id: "recruiter-job-123",
    }], "https://talentgraph.example");

    expect(email.text).toContain("https://talentgraph.example/app/jobs");
    expect(email.text).not.toContain("undefined");
  });
});
