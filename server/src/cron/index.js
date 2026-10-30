import cron from "node-cron";
import { supabaseAdmin } from "../utils/supabase.js";
import { logger } from "../utils/logger.js";
import { syncActiveSources } from "../services/jobs.js";

export function startCron() {
  cron.schedule("0 */3 * * *", async () => {
    try {
      await syncActiveSources();
    } catch (error) {
      logger.error({ code: error.code || "JOB_SYNC_FAILED" }, "Scheduled job sync failed");
    }
  });
  cron.schedule("0 * * * *", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabaseAdmin.from("jobs")
      .update({ status: "expired", closed_at: new Date().toISOString() })
      .eq("status", "open")
      .not("application_deadline", "is", null)
      .lt("application_deadline", today);
    if (error) logger.error({ code: error.code }, "Scheduled job expiry update failed");
  });
  logger.info("Scheduled vacancy sync and expiry tasks");
}
