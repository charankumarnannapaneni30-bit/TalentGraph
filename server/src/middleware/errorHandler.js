import { ZodError } from "zod";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";

export function notFoundHandler(_req, _res, next) {
  next(new AppError(404, "NOT_FOUND", "The requested endpoint was not found."));
}

export function errorHandler(error, req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Some submitted information is invalid.",
        details: error.issues.map(({ path, code, message }) => ({ path, code, message })),
      },
    });
  }
  const status = error instanceof AppError ? error.status : error.status || 500;
  const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
  logger.error({
    error_name: error.name,
    method: req.method,
    route: req.route?.path || "unmatched",
    status,
    code,
  }, "API request failed");
  const message = error instanceof AppError ? error.message : "An unexpected error occurred.";
  return res.status(status).json({
    error: {
      code,
      message: env.NODE_ENV === "production" && status >= 500 ? "An unexpected error occurred." : message,
      ...(error instanceof AppError && error.details ? { details: error.details } : {}),
    },
  });
}
