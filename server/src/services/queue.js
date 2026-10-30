import PQueue from "p-queue";
import { logger } from "../utils/logger.js";

export const workQueue = new PQueue({ concurrency: 2 });

export function enqueueWork(task, context = {}) {
  return workQueue.add(async () => {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await task();
      } catch (error) {
        lastError = error;
        if (error?.status >= 400 && error.status < 500) break;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
      }
    }
    logger.error({ ...context, code: lastError?.code || "QUEUE_TASK_FAILED" }, "Queued task exhausted retries");
    throw lastError;
  });
}
