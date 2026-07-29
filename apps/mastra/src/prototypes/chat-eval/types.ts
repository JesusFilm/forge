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
  /**
   * The exact questions this run covered. `--limit` changes the evaluated
   * subset, so questionSetId alone would let a 1-question smoke look
   * comparable to a full 6-question run. Two runs are comparable only when
   * these match.
   */
  questionIds: string[]
  /** Covers the criteria text too — editing a rubric must break comparability. */
  criteriaSha256: string
  answeringModels: string[]
  gitSha: string | null
  /**
   * Whether retrieval was in the loop, and over which corpus snapshot. A run
   * with retrieval is NOT comparable to one without, and two fixture runs with
   * different corpus hashes are not comparable to each other — otherwise a
   * re-index reads as a prompt regression.
   */
  retrieval:
    | { mode: "none" }
    /** Deterministic: our query, committed passages, injected as a completed
     *  tool exchange. The default and the only comparable mode. */
    | { mode: "fixtures"; corpusSha256: string; topK: number }
    /** Live loop: the MODEL chose the query, so retrieval quality is part of
     *  the measurement. Not comparable across runs. */
    | { mode: "tool-loop"; corpusSha256: string; topK: number }
}

/** Two runs may only be compared when every field here agrees. */
export function identityMismatch(
  left: RunIdentity,
  right: RunIdentity,
): string[] {
  const problems: string[] = []
  if (left.promptSha256 !== right.promptSha256) problems.push("prompt")
  if (left.criteriaSha256 !== right.criteriaSha256) problems.push("criteria")
  if (left.questionIds.join(",") !== right.questionIds.join(","))
    problems.push("questions")
  if (left.answeringModels.join(",") !== right.answeringModels.join(","))
    problems.push("answering models")
  // Artifacts written before this field existed have no `retrieval` at all.
  // Treat absence as its own mode rather than dereferencing it — an older file
  // must report as incomparable, not crash the report.
  const leftMode = left.retrieval?.mode ?? "unstamped"
  const rightMode = right.retrieval?.mode ?? "unstamped"
  if (leftMode !== rightMode) problems.push("retrieval mode")
  else if (
    // Both retrieval modes carry a corpus snapshot, and a re-index between two
    // runs of EITHER mode reads as a prompt regression if it goes unnoticed.
    (leftMode === "fixtures" || leftMode === "tool-loop") &&
    left.retrieval.mode !== "none" &&
    right.retrieval.mode !== "none" &&
    left.retrieval.corpusSha256 !== right.retrieval.corpusSha256
  )
    problems.push("corpus snapshot")
  return problems
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
  /** Present only in retrieval mode. The query is the MODEL's, not ours. */
  toolCalls?: Array<{
    name: string
    arguments: string
    servedFrom: "fixture" | "fixture-fallback"
  }>
  /** Model never called the tool despite being told to always call it. */
  skippedTool?: boolean
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
  /**
   * Whether `quote` is really present in the answer.
   *
   * REPORT-ONLY, deliberately. A non-empty quote that the answer never
   * contained is a fabricated citation by the judge — the exact failure the
   * quote requirement is supposed to prevent — and until we have measured how
   * often it happens, turning it into a hard error would make the first real
   * run unreadable. Null when there is no quote to check.
   *
   *   "exact"      — verbatim substring
   *   "normalised" — matches after collapsing whitespace, case, and smart
   *                  punctuation. Still evidence, but the judge retyped it.
   *   "absent"     — not in the answer at all. Fabricated.
   */
  quoteFidelity: "exact" | "normalised" | "absent" | null
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
