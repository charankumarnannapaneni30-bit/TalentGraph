import { z } from "zod";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";

const userSchema = z.object({
  login: z.string(),
  name: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  blog: z.string().nullable().optional(),
  public_repos: z.number().int().nonnegative(),
});
const repoSchema = z.object({
  name: z.string(),
  full_name: z.string(),
  description: z.string().nullable().optional(),
  topics: z.array(z.string()).default([]),
  fork: z.boolean(),
  stargazers_count: z.number().int().nonnegative(),
  pushed_at: z.string().nullable().optional(),
  html_url: z.string().url(),
  language: z.string().nullable().optional(),
  size: z.number().int().nonnegative().default(0),
});

async function githubGet(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": env.JOB_SYNC_USER_AGENT,
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) throw new AppError(422, "GITHUB_NOT_FOUND", "The public GitHub profile or repository was not found.");
  if (!response.ok) throw new AppError(502, "GITHUB_API_FAILED", "GitHub could not provide public profile data.");
  return response.json();
}

function decodeReadme(contents) {
  if (contents?.encoding !== "base64" || typeof contents.content !== "string") return "";
  return Buffer.from(contents.content, "base64").toString("utf8").slice(0, 4000);
}

export async function fetchGitHubEvidence(sourceUrl) {
  const parsedUrl = new URL(sourceUrl);
  const segments = parsedUrl.pathname.split("/").filter(Boolean);
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "github.com" || segments.length < 1 || segments.length > 2) {
    throw new AppError(422, "INVALID_GITHUB_URL", "Use a public GitHub profile or repository URL.");
  }
  const [owner, repository] = segments;
  if (repository) {
    const raw = await githubGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`);
    const parsed = repoSchema.safeParse(raw);
    if (!parsed.success) throw new AppError(502, "GITHUB_RESPONSE_INVALID", "GitHub returned an unexpected repository record.");
    if (parsed.data.fork || parsed.data.size === 0) return { profile: { login: owner }, repositories: [] };
    return { profile: { login: owner }, repositories: [await enrichRepo(parsed.data)] };
  }
  const rawUser = await githubGet(`/users/${encodeURIComponent(owner)}`);
  const user = userSchema.safeParse(rawUser);
  if (!user.success) throw new AppError(502, "GITHUB_RESPONSE_INVALID", "GitHub returned an unexpected profile record.");
  const rawRepos = await githubGet(`/users/${encodeURIComponent(owner)}/repos?sort=updated&per_page=100&type=owner`);
  if (!Array.isArray(rawRepos)) throw new AppError(502, "GITHUB_RESPONSE_INVALID", "GitHub returned an unexpected repository list.");
  const repos = rawRepos.flatMap((item) => {
    const result = repoSchema.safeParse(item);
    return result.success && !result.data.fork && result.data.size > 0 ? [result.data] : [];
  }).slice(0, 15);
  const enriched = [];
  for (const repo of repos) enriched.push(await enrichRepo(repo));
  return {
    profile: {
      login: user.data.login,
      name: user.data.name || null,
      bio: user.data.bio || null,
      blog: user.data.blog || null,
      public_repos: user.data.public_repos,
    },
    repositories: enriched,
  };
}

async function enrichRepo(repo) {
  const [languagesResult, readmeResult, contentsResult, workflowsResult] = await Promise.allSettled([
    githubGet(`/repos/${encodeURIComponent(repo.full_name)}/languages`),
    githubGet(`/repos/${encodeURIComponent(repo.full_name)}/readme`),
    githubGet(`/repos/${encodeURIComponent(repo.full_name)}/contents`),
    githubGet(`/repos/${encodeURIComponent(repo.full_name)}/contents/.github/workflows`),
  ]);
  const languages = languagesResult.status === "fulfilled" && typeof languagesResult.value === "object"
    ? Object.keys(languagesResult.value)
    : repo.language ? [repo.language] : [];
  const rootFiles = contentsResult.status === "fulfilled" && Array.isArray(contentsResult.value)
    ? contentsResult.value.flatMap((entry) => typeof entry.name === "string" ? [entry.name.toLowerCase()] : [])
    : [];
  const hasWorkflows = workflowsResult.status === "fulfilled";
  return {
    name: repo.name,
    description: repo.description || "",
    topics: repo.topics,
    languages,
    stars: repo.stargazers_count,
    last_push: repo.pushed_at || null,
    url: repo.html_url,
    readme: readmeResult.status === "fulfilled" ? decodeReadme(readmeResult.value) : "",
    practices: {
      tests: rootFiles.some((name) => ["test", "tests", "__tests__", "spec"].includes(name)),
      ci: hasWorkflows || rootFiles.includes(".travis.yml"),
      dockerfile: rootFiles.includes("dockerfile"),
    },
  };
}
