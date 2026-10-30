import pino from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ["req.headers.authorization", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY"],
    censor: "[REDACTED]",
  },
});
