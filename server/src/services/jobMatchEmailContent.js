function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

export function buildJobMatchEmail(notifications, clientOrigin) {
  const isReopenedOnly = notifications.every((notification) => notification.type === "job_reopened");
  const subject = isReopenedOnly ? "A matched job has reopened" : "New job matches are ready";
  const jobs = notifications.map((notification) => {
    const url = new URL(`/app/jobs/${encodeURIComponent(notification.job_id)}`, clientOrigin).toString();
    return {
      title: notification.title,
      body: notification.body,
      url,
    };
  });
  const text = [
    subject,
    "",
    ...jobs.flatMap((job) => [job.title, job.body, job.url, ""]),
    "You received this because job-match notifications are enabled in your TalentGraph preferences.",
  ].join("\n");
  const htmlJobs = jobs.map((job) => `
    <li style="margin:0 0 16px;padding:16px;border:1px solid #e7eaf1;border-radius:8px">
      <strong>${escapeHtml(job.title)}</strong>
      <p style="margin:8px 0;color:#586174">${escapeHtml(job.body)}</p>
      <a href="${escapeHtml(job.url)}" style="color:#5146e5">View job match</a>
    </li>`).join("");
  const html = `<!doctype html>
    <html><body style="margin:0;padding:24px;background:#f5f7fb;font:15px Arial,sans-serif;color:#172033">
      <main style="max-width:600px;margin:auto;padding:24px;background:#fff;border-radius:12px">
        <h1 style="font-size:22px">${escapeHtml(subject)}</h1>
        <ul style="padding:0;list-style:none">${htmlJobs}</ul>
        <p style="font-size:12px;color:#748099">You received this because job-match notifications are enabled in your TalentGraph preferences.</p>
      </main>
    </body></html>`;
  return { subject, text, html };
}
