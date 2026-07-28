/**
 * PROTOTYPE — the on-disk record shapes.
 *
 * The file between step 1 and step 2 is the whole design. Answers are captured
 * once; the judge reads them as many times as the rubric changes.
 *
 * Every run stamps its own identity (prompt, question set, models, judge). The
 * offline search eval does the same thing (`SearchEvalMetadata`) and it is what
 * lets a runner refuse to compare unlike runs — otherwise you swap a model and
 * report it as a prompt result.
 */

export type RunIdentity = {
  promptId: string
  promptSha256: string
  questionSetId: string
  answeringModels: string[]
}

export type AnswerRecord = {
  questionId: string
  category: string
  model: string
  ok: boolean
  text: string | null
  /** "length" means the answer was truncated — an ERROR, never a low score. */
  finishReason: string | null
  usage: { input: number; output: number } | null
  costUsd: number | null
  latencyMs: number
  error?: string
}

export type AnswerRun = {
  kind: "chat-eval-answers"
  startedAt: string
  finishedAt: string
  identity: RunIdentity
  answers: AnswerRecord[]
}

/* ------------------------------------------------------------------ */
/* Judge design A — per-criterion verdict with a mandatory quote.      */
/* This is what feat-322 proposes and what the prototype must falsify. */
/* ------------------------------------------------------------------ */

export type CriterionVerdict = {
  criterionId: string
  verdict: "satisfied" | "violated" | "not-applicable"
  /** The words from the answer that prove it. Absent = a judge protocol error. */
  quote: string | null
}

/* ------------------------------------------------------------------ */
/* Judge design B — 0..1 scores per named dimension.                   */
/* The house pattern (services/devotional/safety-gate.ts), run over    */
/* the SAME answers so the two designs can be compared directly.       */
/* ------------------------------------------------------------------ */

export type DimensionScores = {
  scores: Record<string, number>
  reasons: string[]
}

export type Band = "pass" | "borderline" | "fail" | "error"

export type JudgedAnswer = {
  questionId: string
  category: string
  model: string
  band: Band
  /** satisfied / applicable, or the mean dimension score. Null when band is "error". */
  score: number | null
  verdicts?: CriterionVerdict[]
  dimensions?: DimensionScores
  /**
   * Judge PROTOCOL failures — a missing verdict, a violation with no quote, a
   * truncated answer, a judge call that threw. Reported separately and never
   * counted as the prompt failing. Non-empty means band is "error".
   */
  errors: string[]
  judgeUsage: { input: number; output: number } | null
  judgeCostUsd: number | null
  judgeLatencyMs: number
}

export type JudgeMode = "verdicts" | "scores"

export type JudgeRun = {
  kind: "chat-eval-judgements"
  startedAt: string
  finishedAt: string
  mode: JudgeMode
  judgeModel: string
  identity: RunIdentity
  judged: JudgedAnswer[]
}

/** Deliberately blunt. A decimal grid invites ranking on a single sample. */
export const BAND_THRESHOLDS = { pass: 0.9, borderline: 0.7 } as const

export function bandFor(score: number): Band {
  if (score >= BAND_THRESHOLDS.pass) return "pass"
  if (score >= BAND_THRESHOLDS.borderline) return "borderline"
  return "fail"
}
