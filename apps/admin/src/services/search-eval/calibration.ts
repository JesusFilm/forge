/**
 * Calibration set runner.
 *
 * Hand-labeled cases at `apps/admin/eval/calibration.json` exercise
 * the LLM judge against deliberately easy comparisons — obvious-A-
 * wins, obvious-tie, and both-irrelevant. Run on every harness
 * invocation to catch judge instability before it's mistaken for a
 * real regression.
 *
 * PASS = ≥80% of cases match expected verdict. Failure does NOT
 * abort the run; the operator decides whether to trust the result.
 *
 * Per plan §Unit 8.
 */

import { readFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import type { Judge } from "./judge"
import type { CalibrationCase, CalibrationReport, Verdict } from "./types"

const VERDICT_VALUES = [
  "clearly-A-better",
  "slightly-A-better",
  "tie",
  "slightly-B-better",
  "clearly-B-better",
  "both-irrelevant",
] as const

const SearchResultSchema = z.object({
  type: z.enum(["video", "experience"]),
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  imageUrl: z.string().nullable(),
  snippet: z.string(),
  startSeconds: z.number().nullable(),
  playbackId: z.string().nullable(),
  score: z.number(),
})

const CalibrationCaseSchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  locale: z.string().min(1),
  expected: z.enum(VERDICT_VALUES),
  rationale: z.string().min(1),
  listA: z.array(SearchResultSchema),
  listB: z.array(SearchResultSchema),
})

const CalibrationFileSchema = z.object({
  cases: z.array(CalibrationCaseSchema),
})

export const CALIBRATION_PASS_THRESHOLD = 0.8

export class CalibrationLoadError extends Error {
  constructor(
    readonly code: "not_found" | "invalid_json" | "validation",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "CalibrationLoadError"
  }
}

export type CalibrationLoaderOptions = {
  /** Override file path. Defaults to `apps/admin/eval/calibration.json`. */
  filePath?: string
}

function defaultPath(): string {
  return path.resolve(process.cwd(), "apps/admin/eval/calibration.json")
}

/** Read + validate the calibration cases file. Strict on shape — we
 *  want to catch a hand-edit typo before it shows up as a "judge is
 *  wrong" false alarm at run-time. */
export async function loadCalibrationCases(
  options: CalibrationLoaderOptions = {},
): Promise<CalibrationCase[]> {
  const filePath = options.filePath ?? defaultPath()
  let raw: string
  try {
    raw = await readFile(filePath, "utf8")
  } catch (cause) {
    throw new CalibrationLoadError(
      "not_found",
      `calibration file not found at ${filePath}`,
      cause,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new CalibrationLoadError(
      "invalid_json",
      `calibration file ${filePath} is not valid JSON`,
      cause,
    )
  }

  const validated = CalibrationFileSchema.safeParse(parsed)
  if (!validated.success) {
    throw new CalibrationLoadError(
      "validation",
      `calibration file ${filePath} failed schema validation: ${validated.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")}`,
    )
  }

  // Cast through unknown to satisfy the structural mismatch between
  // the Zod schema's enum-typed locale (z.string()) and our nominal
  // HarnessLocale union — calibration cases are operator-authored
  // and may target locales outside the harness set during one-off
  // probes.
  return validated.data.cases as unknown as CalibrationCase[]
}

export type RunCalibrationOptions = {
  /** Pre-loaded cases. If absent, calls `loadCalibrationCases()`. */
  cases?: CalibrationCase[]
  /** Path override forwarded to the loader (only used when `cases`
   *  is absent). */
  filePath?: string
  /** Optional logger; matches admin's `[search] event=...` shape. */
  logger?: { warn: (message: string) => void; info: (message: string) => void }
}

const defaultLogger = {
  warn: (m: string) => console.warn(m),
  info: (m: string) => console.log(m),
}

/**
 * Run the calibration cases against a judge. Returns aggregate
 * pass/fail + per-case detail. Emits a structured `event=judge_calibration_failure`
 * log line at error level on FAIL — matches the documented mitigation
 * for silent OpenRouter degradation.
 *
 * Empty case list short-circuits to a passed=true report (with a
 * separate warning log) — operators sometimes blank out the file
 * temporarily; we don't want that to abort a run.
 */
export async function runCalibration(
  judge: Judge,
  options: RunCalibrationOptions = {},
): Promise<CalibrationReport> {
  const logger = options.logger ?? defaultLogger
  const cases =
    options.cases ??
    (await loadCalibrationCases({ filePath: options.filePath }))

  if (cases.length === 0) {
    logger.warn(
      `[search-eval] event=judge_calibration_skipped reason=empty_case_list`,
    )
    return { passed: true, matched: 0, total: 0, cases: [] }
  }

  // Run sequentially. Calibration is small (~10 cases); avoiding a
  // burst of parallel calls also avoids confusing the rate-limit
  // counter at run start.
  const reportCases: CalibrationReport["cases"] = []
  let matched = 0
  for (const c of cases) {
    let observed: Verdict
    try {
      const result = await judge.judgePair({
        query: c.query,
        locale: c.locale,
        listA: c.listA,
        listB: c.listB,
      })
      observed = result.verdict
    } catch (cause) {
      // A judge transport / validation failure is itself a
      // calibration failure — we can't trust the run when the judge
      // can't even handle a hand-labeled case. Record an obviously-
      // mismatched verdict so the case is counted as a fail.
      logger.warn(
        `[search-eval] event=judge_calibration_judge_error case=${c.id} message=${cause instanceof Error ? cause.message : String(cause)}`,
      )
      observed = c.expected === "tie" ? "clearly-A-better" : "tie"
    }
    const pass = observed === c.expected
    if (pass) matched++
    reportCases.push({ id: c.id, expected: c.expected, observed, pass })
  }

  const ratio = matched / cases.length
  const passed = ratio >= CALIBRATION_PASS_THRESHOLD

  if (!passed) {
    logger.warn(
      `[search-eval] event=judge_calibration_failure cases.failed=${cases.length - matched} cases.total=${cases.length} ratio=${ratio.toFixed(3)}`,
    )
  } else {
    logger.info(
      `[search-eval] event=judge_calibration_pass cases.matched=${matched} cases.total=${cases.length} ratio=${ratio.toFixed(3)}`,
    )
  }

  return { passed, matched, total: cases.length, cases: reportCases }
}
