import { env } from "../config/env.js";
import { supabaseAdmin } from "../utils/supabase.js";
import { logger } from "../utils/logger.js";
import { buildJobMatchEmail } from "./jobMatchEmailContent.js";

let missingConfigurationLogged = false;

export async function sendJobMatchNotificationEmail(userId, notifications) {
  if (!notifications.length) return;
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    if (!missingConfigurationLogged) {
      logger.warn("Job-match email delivery is disabled; configure RESEND_API_KEY and RESEND_FROM_EMAIL.");
      missingConfigurationLogged = true;
    }
    return;
  }

  let userEmail;
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error || !data?.user?.email) {
      logger.warn({ userId, code: error?.code || "EMAIL_NOT_FOUND" }, "Could not resolve account email for job-match notification");
      return;
    }
    userEmail = data.user.email;
  } catch (failure) {
    logger.warn({ userId, code: failure?.code || "EMAIL_LOOKUP_FAILED" }, "Could not resolve account email for job-match notification");
    return;
  }

  const email = buildJobMatchEmail(notifications, env.CLIENT_ORIGIN);
  let response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: [userEmail],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (failure) {
    logger.warn({ userId, code: failure?.code || "EMAIL_REQUEST_FAILED" }, "Could not send job-match notification email");
    return;
  }

  if (!response.ok) {
    logger.warn({ userId, status: response.status }, "Email provider rejected job-match notification");
    return;
  }
  logger.info({ userId, notificationCount: notifications.length }, "Sent job-match notification email");
}
