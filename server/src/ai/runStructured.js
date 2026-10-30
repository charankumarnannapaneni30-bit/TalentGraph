import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";

let client;

function getClient() {
  if (!env.GEMINI_API_KEY) throw new AppError(503, "AI_NOT_CONFIGURED", "AI document processing is not configured on this server.");
  client ||= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return client;
}

function isTransientProviderError(error) {
  const status = Number(error?.status || error?.response?.status);
  const code = error?.code;
  return [429, 500, 502, 503, 504].includes(status)
    || ["ECONNABORTED", "ECONNRESET", "EAI_AGAIN", "ETIMEDOUT"].includes(code);
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
        if (error?.message === "AI request timed out.") {
          throw new AppError(504, "AI_TIMEOUT", "AI processing timed out. Please retry.");
        }
        throw new AppError(502, "AI_REQUEST_FAILED", "The AI provider could not process this request.");
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
