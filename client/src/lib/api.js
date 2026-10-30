import { supabase } from "./supabase";

const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080/api/v1";

export async function api(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(options.headers || {});
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  if (!(options.body instanceof FormData) && options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`The API returned an invalid response (${response.status}).`);
  }
  if (response.status === 401) {
    await supabase.auth.signOut();
  }
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Request failed (${response.status}).`);
  }
  return payload.data;
}

export const apiJson = (path, method, body) => api(path, {
  method,
  body: JSON.stringify(body),
});
