export const INTERVIEW_QUESTION_LIMIT = 10;
export const INTERVIEW_AUDIO_MAX_DURATION_MS = 5 * 60_000;
export const INTERVIEW_AUDIO_MAX_BYTES = 15 * 1024 * 1024;

export function getInterviewDifficultyGuidance(level = "medium") {
  const guidance = {
    easy: "Keep every question beginner-friendly and direct. Focus on foundational concepts, simple explanations, basic examples, and introductory situations. Avoid multi-step problems, tricky edge cases, and assumptions of professional experience.",
    medium: "Use a practical, intermediate level for every question. Ask for concrete examples, application of relevant concepts, and clear reasoning. Include realistic constraints or trade-offs without relying on obscure knowledge or assuming seniority.",
    hard: "Use a challenging, advanced level for every question while staying relevant to the target role and candidate profile. Probe multi-step reasoning, competing trade-offs, edge cases, failure modes, alternatives, and how outcomes would be evaluated. Do not rely on obscurity or assume undocumented expertise.",
  };
  return guidance[level] || guidance.medium;
}
