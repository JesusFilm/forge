/**
 * Seeker eval — on-disk record shapes and run identity.
 *
 * The file between steps is the whole design: answers are captured once (the
 * slow, paid step); the judge re-reads them for cents as the rubric iterates;
 * the report and score read both. Every artifact stamps its own identity, and
 * `identityMismatch` refuses to pair artifacts that differ on anything that
 * would silently change what a comparison means — otherwise you swap a model
 * and report it as a prompt result.
 */

export type RetrievalStamp =
  | { mode: "none" }
  /** Deterministic: our query, committed passages, injected as a completed
   *  tool exchange. The fast mode, and the only injected-comparable mode. */
  | { mode: "fixtures"; corpusSha256: string; topK: number }
  /** Live loop: the MODEL chose the query, so retrieval quality is part of
   *  the measurement. Comparable only to other tool-loop runs on the same
   *  corpus. */
  | { mode: "tool-loop"; corpusSha256: string; topK: number }

export type DecodingParameters = {
  temperature: number
  maxTokens: number
}

export type JudgeStamp = {
  model: string
  /** Hash over the judge's system prompt + output schema — editing either
   *  changes what a verdict means, so it breaks comparability. */
  rubricSha256: string
}

export type RunIdentity = {
  /** sha256 of the resolved system prompt the answers were generated under. */
  promptSha256: string
  /**
   * Where the prompt came from (feat-272): `langfuse` when resolved from the
   * managed `seeker-system` prompt, `fallback` when the compiled-in constant
   * served. A fallback-graded run and a langfuse-graded run are not the same
   * measurement even at identical text, so both source and version stamp.
   */
  promptSource: "langfuse" | "fallback"
  promptLangfuseVersion: number | null
  promptLangfuseLabel: string | null
  /** Version of the eval-owned line→section mapping (prompt-sections.ts). */
  sectionMappingVersion: string
  questionSetId: string
  /**
   * The exact questions this run covered. `--limit` changes the evaluated
   * subset, so questionSetId alone would let a 1-question smoke look
   * comparable to a full 10-question run.
   */
  questionIds: string[]
  /** Covers the criteria text AND section tags — editing a rubric must break
   *  comparability. */
  criteriaSha256: string
  answeringModels: string[]
  /** Answer-generation decoding parameters — a temperature change changes
   *  the distribution being measured. */
  decoding: DecodingParameters
  /**
   * Which sample of an identical configuration this is (multi-sample
   * nightly). Deliberately NOT a mismatch dimension: comparing samples of
   * the same identity is the point of sampling.
   */
  sampleId: string
  gitSha: string | null
  retrieval: RetrievalStamp
  /** Stamped by the judge run; null on answer runs (the judge is not known
   *  yet). Compared only when both sides carry it. */
  judge: JudgeStamp | null
}

/**
 * Two runs may only be compared when every field here agrees.
 *
 * `scope` exists for the ONE legitimate cross-rubric pairing: a judge run
 * being rendered against the answers file it graded. Criteria only exist at
 * judge time — rubric iteration against cached answers is the design's whole
 * cost model — so `"generation"` scope compares everything that shaped the
 * ANSWERS (prompt, questions, models, decoding, retrieval) and skips the
 * criteria hash and judge stamp. The default `"full"` scope (baselines,
 * judge-repeatability, any run-to-run diff) compares everything.
 */
export function identityMismatch(
  left: RunIdentity,
  right: RunIdentity,
  scope: "full" | "generation" = "full",
): string[] {
  const problems: string[] = []
  if (left.promptSha256 !== right.promptSha256) problems.push("prompt")
  if (left.promptSource !== right.promptSource) problems.push("prompt source")
  if (
    left.promptLangfuseVersion !== right.promptLangfuseVersion ||
    left.promptLangfuseLabel !== right.promptLangfuseLabel
  )
    problems.push("langfuse prompt version")
  if (left.sectionMappingVersion !== right.sectionMappingVersion)
    problems.push("section mapping")
  if (left.questionSetId !== right.questionSetId) problems.push("question set")
  if (left.questionIds.join(",") !== right.questionIds.join(","))
    problems.push("questions")
  if (scope === "full" && left.criteriaSha256 !== right.criteriaSha256)
    problems.push("criteria")
  if (left.answeringModels.join(",") !== right.answeringModels.join(","))
    problems.push("answering models")
  if (
    left.decoding.temperature !== right.decoding.temperature ||
    left.decoding.maxTokens !== right.decoding.maxTokens
  )
    problems.push("decoding parameters")

  // Artifacts written before a field existed must report as incomparable,
  // not crash the comparison.
  const leftMode = left.retrieval?.mode ?? "unstamped"
  const rightMode = right.retrieval?.mode ?? "unstamped"
  if (leftMode !== rightMode) problems.push("retrieval mode")
  else if (
    left.retrieval?.mode !== "none" &&
    right.retrieval?.mode !== "none" &&
    left.retrieval != null &&
    right.retrieval != null &&
    left.retrieval.corpusSha256 !== right.retrieval.corpusSha256
  )
    problems.push("corpus snapshot")

  // Judge stamp: compared only when both sides have one. An answers run
  // (judge: null) pairs with any judge run over it; two JUDGE runs with
  // different judges or rubrics must never be diffed against each other.
  if (scope === "full" && left.judge != null && right.judge != null) {
    if (left.judge.model !== right.judge.model) problems.push("judge model")
    if (left.judge.rubricSha256 !== right.judge.rubricSha256)
      problems.push("judge rubric")
  }

  return problems
}

export type ToolCallRecord = {
  name: string
  /** The query the MODEL chose (tool-loop) or ours verbatim (injected). */
  arguments: string
  servedFrom: "fixture" | "fixture-fallback"
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
  /** Present only in retrieval mode. */
  toolCalls?: ToolCallRecord[]
  /** Model never called the tool despite being told to always call it. */
  skippedTool?: boolean
}

export const ANSWER_RUN_KIND = "seeker-eval-answers"
/** The prototype's kind literal — reference-runs/ artifacts carry it. */
export const LEGACY_ANSWER_RUN_KIND = "chat-eval-answers"

export type AnswerRun = {
  kind: typeof ANSWER_RUN_KIND
  startedAt: string
  finishedAt: string
  identity: RunIdentity
  answers: AnswerRecord[]
}

/* ------------------------------------------------------------------ */
/* Judge output — amended design (2026-08-03):                         */
/* per-criterion binary verdict + REQUIRED free-text reasoning.        */
/* No evidence types, no quote fields, no substring verification, no   */
/* verdict voiding. Protocol errors are ONLY malformed output.         */
/* ------------------------------------------------------------------ */

export type CriterionVerdict = {
  criterionId: string
  verdict: "satisfied" | "violated"
  /** Required free text — the judge's stated basis, for human triage only.
   *  Never machine-verified (the quote-fidelity design measured 18–22%
   *  fabrication and was dropped by the amendment). */
  reasoning: string
}

/**
 * Cell status:
 * - "judged"       — a protocol-clean verdict set exists.
 * - "answer-error" — the ANSWER was unusable (failed call, empty text,
 *                    truncated). Never a judge fault, never scored.
 * - "invalid"      — the JUDGE's output stayed malformed after the one
 *                    permitted retry (missing/duplicate/unknown criterion,
 *                    invalid verdict, empty reasoning). Excluded from the
 *                    score and surfaced in the report.
 */
export type JudgedCellStatus = "judged" | "answer-error" | "invalid"

export type JudgedAnswer = {
  questionId: string
  category: string
  model: string
  status: JudgedCellStatus
  verdicts?: CriterionVerdict[]
  /** Protocol problems (or the answer error), for the report. */
  errors: string[]
  /** True when the first judge attempt was malformed and the retry graded. */
  retried: boolean
  judgeUsage: { input: number; output: number } | null
  judgeCostUsd: number | null
  judgeLatencyMs: number
}

export const JUDGE_RUN_KIND = "seeker-eval-judgements"

export type JudgeRun = {
  kind: typeof JUDGE_RUN_KIND
  startedAt: string
  finishedAt: string
  identity: RunIdentity
  judged: JudgedAnswer[]
}

/* ------------------------------------------------------------------ */
/* Legacy artifact support                                             */
/* ------------------------------------------------------------------ */

type LegacyRetrieval = RetrievalStamp | undefined

export type LegacyAnswerRun = {
  kind: typeof LEGACY_ANSWER_RUN_KIND
  startedAt: string
  finishedAt: string
  identity: {
    promptId: string
    promptSha256: string
    questionSetId: string
    questionIds: string[]
    criteriaSha256: string
    answeringModels: string[]
    gitSha: string | null
    retrieval?: LegacyRetrieval
  }
  answers: AnswerRecord[]
}

/**
 * Normalize a prototype-era answers artifact (reference-runs/) into the new
 * identity so the judge can grade it. The filled-in fields are the
 * prototype's actual constants, stated here once:
 * - promptSource "fallback": the prototype hand-composed the prompt from the
 *   code constant; nothing ever came from Langfuse.
 * - decoding { 0.7, 1600 }: the prototype's hard-coded answer decoding.
 * - sectionMappingVersion "legacy/unstamped": no mapping existed, so a
 *   legacy run REFUSES to compare against a new-stamped run — deliberate.
 * - criteriaSha256 is kept AS RECORDED (the old rubric); the judge run over
 *   it stamps the CURRENT criteria hash, which is what repeatability runs
 *   compare among themselves.
 */
export function normalizeLegacyAnswerRun(run: LegacyAnswerRun): AnswerRun {
  return {
    kind: ANSWER_RUN_KIND,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    identity: {
      promptSha256: run.identity.promptSha256,
      promptSource: "fallback",
      promptLangfuseVersion: null,
      promptLangfuseLabel: null,
      sectionMappingVersion: "legacy/unstamped",
      questionSetId: run.identity.questionSetId,
      questionIds: run.identity.questionIds,
      criteriaSha256: run.identity.criteriaSha256,
      answeringModels: run.identity.answeringModels,
      decoding: { temperature: 0.7, maxTokens: 1_600 },
      sampleId: "legacy-1",
      gitSha: run.identity.gitSha,
      retrieval: run.identity.retrieval ?? { mode: "none" },
      judge: null,
    },
    answers: run.answers,
  }
}

/** Accepts current or prototype-era answer files; throws on anything else. */
export function coerceAnswerRun(value: unknown): AnswerRun {
  if (value == null || typeof value !== "object") {
    throw new Error("not an answers file")
  }
  const kind = (value as { kind?: unknown }).kind
  if (kind === ANSWER_RUN_KIND) return value as AnswerRun
  if (kind === LEGACY_ANSWER_RUN_KIND) {
    return normalizeLegacyAnswerRun(value as LegacyAnswerRun)
  }
  throw new Error(
    `not a seeker-eval answers file (kind: ${String(kind)}; expected ${ANSWER_RUN_KIND} or legacy ${LEGACY_ANSWER_RUN_KIND})`,
  )
}

/** Deliberately blunt. A decimal grid invites ranking on a single sample. */
export const BAND_THRESHOLDS = { pass: 0.9, borderline: 0.7 } as const

export type Band = "pass" | "borderline" | "fail"

export function bandFor(score: number): Band {
  if (score >= BAND_THRESHOLDS.pass) return "pass"
  if (score >= BAND_THRESHOLDS.borderline) return "borderline"
  return "fail"
}
