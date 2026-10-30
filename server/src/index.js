import app from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { startCron } from "./cron/index.js";

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, environment: env.NODE_ENV }, "TalentGraph API started");
  if (env.ENABLE_CRON) startCron();
});

function shutdown(signal) {
  logger.info({ signal }, "Shutting down API");
  server.close((error) => {
    if (error) {
      logger.error({ err: error }, "API shutdown failed");
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
