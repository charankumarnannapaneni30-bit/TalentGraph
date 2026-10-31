import { z } from "zod";

export const interviewQuestionSchema = z.object({
  question: z.string().trim().min(10).max(700),
});

export const interviewTranscriptSchema = z.object({
  transcript: z.string().trim().max(6000),
});

export const interviewFeedbackSchema = z.object({
  session_summary: z.string().trim().min(20).max(1200),
  overall_feedback: z.string().trim().min(20).max(2000),
  strengths: z.array(z.string().trim().min(5).max(400)).max(5),
  areas_to_improve: z.array(z.string().trim().min(5).max(400)).max(5),
  development_suggestions: z.array(z.object({
    focus: z.string().trim().min(3).max(120),
    action: z.string().trim().min(10).max(500),
  })).min(1).max(5),
  example_tip: z.string().trim().min(10).max(800),
});
