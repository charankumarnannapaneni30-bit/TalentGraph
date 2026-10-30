import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

let client;

function getClient() {
  if (!env.GEMINI_API_KEY) throw new AppError(503, "AI_NOT_CONFIGURED", "AI document processing is not configured on this server.");
  client ||= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return client;
}

export function isTransientProviderError(error) {
  const status = getProviderErrorStatus(error);
  const code = error?.code;
  return [408, 429, 500, 502, 503, 504].includes(status)
    || ["ECONNABORTED", "ECONNRESET", "EAI_AGAIN", "ETIMEDOUT"].includes(code);
}

export function getProviderErrorStatus(error) {
  const status = error?.status || error?.response?.status || error?.error?.status || error?.cause?.status;
  const numericStatus = Number(status);
  if (numericStatus) return numericStatus;
  const match = String(error?.message || "").match(/\bHTTP\s+(\d{3})\b/i);
  return match ? Number(match[1]) : 0;
}

export function providerFailure(error) {
  const status = getProviderErrorStatus(error);
  if (status === 401 || status === 403) {
    return new AppError(503, "AI_CONFIGURATION_ERROR", "The AI service is not configured correctly. Please contact the app administrator.");
  }
  if (status === 404) {
    return new AppError(503, "AI_MODEL_UNAVAILABLE", "The configured AI model is unavailable. Please contact the app administrator.");
  }
  if (status === 429) {
    return new AppError(503, "AI_RATE_LIMITED", "The AI service is busy or has reached its usage limit. Please wait a moment and try again.");
  }
  if (status >= 500 || status === 408 || isTransientProviderError(error)) {
    return new AppError(503, "AI_TEMPORARILY_UNAVAILABLE", "The AI service is temporarily unavailable. Your answer is safe; please try again shortly.");
  }
  return new AppError(502, "AI_REQUEST_FAILED", "The AI service could not process this request. Please try again.");
}

export async function runStructured({ model, systemInstruction, parts, schema, temperature = 0.2 }) {
  const ai = getClient();
  let correction = "";
  let lastValidationError;
  for (let validationAttempt = 0; validationAttempt < 2; validationAttempt += 1) {
    let response;
    for (let transientAttempt = 0; transientAttempt < 3; transientAttempt += 1) {
      let timeout;
      try {
        response = await Promise.race([
          ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [...parts, ...(correction ? [{ text: correction }] : [])] }],
            config: {
              systemInstruction,
              responseMimeType: "application/json",
              responseJsonSchema: z.toJSONSchema(schema, { unrepresentable: "any" }),
              temperature,
            },
          }),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error("AI request timed out.")), 90_000);
          }),
        ]);
        break;
      } catch (error) {
        if (isTransientProviderError(error) && transientAttempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** transientAttempt)));
          continue;
        }
        logger.error({
          model,
          providerStatus: getProviderErrorStatus(error) || undefined,
          providerCode: typeof error?.code === "string" ? error.code : undefined,
          providerErrorName: error?.name || "Error",
        }, "AI provider request failed");
        if (error?.message === "AI request timed out.") {
          throw new AppError(504, "AI_TIMEOUT", "AI processing timed out. Please retry.");
        }
        throw providerFailure(error);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    try {
      const output = JSON.parse(response?.text || "");
      return schema.parse(output);
    } catch (error) {
      lastValidationError = error;
      const details = error?.issues?.map(({ path, message }) => ({ path, message })) || [];
      correction = `Return corrected JSON only. Fix the following validation errors: ${JSON.stringify(details)}.`;
    }
  }
  const details = lastValidationError?.issues?.map(({ path, code, message }) => ({ path, code, message }));
  throw new AppError(502, "AI_VALIDATION_ERROR", "The AI response could not be validated. Please retry processing.", details);
}
