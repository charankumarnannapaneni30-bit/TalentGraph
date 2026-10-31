import { supabase } from "./supabase";
import { notifyFeedback } from "./feedback";

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080/api/v1";
const apiOrigin = configuredBaseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
const baseUrl = `${apiOrigin}/api/v1`;

export async function api(path, options = {}) {
  let session;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    session = data.session;
  } catch (error) {
    notifyFeedback("error", error.message || "Unable to verify your sign-in session.");
    throw error;
  }
  const headers = new Headers(options.headers || {});
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  if (!(options.body instanceof FormData) && options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  } catch (error) {
    if (error?.name !== "AbortError") notifyFeedback("error", error.message || "Unable to reach the server.");
    throw error;
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new Error(`The API returned an invalid response (${response.status}).`);
    notifyFeedback("error", error.message);
    throw error;
  }
  if (response.status === 401) {
    await supabase.auth.signOut();
  }
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Request failed (${response.status}).`);
    notifyFeedback("error", error.message);
    throw error;
  }
  const method = (options.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const successMessage = method === "DELETE"
      ? "Deleted successfully."
      : method === "PATCH" || method === "PUT"
        ? "Changes saved successfully."
        : "Action completed successfully.";
    notifyFeedback("success", successMessage);
  }
  return payload.data;
}

export const apiJson = (path, method, body) => api(path, {
  method,
  body: JSON.stringify(body),
});
