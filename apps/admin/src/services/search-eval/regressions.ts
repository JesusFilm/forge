/**
 * Adversarial regression query loader.
 *
 * Operators append entries to `apps/admin/eval/regressions.json` by
 * hand whenever they spot a bad search result in the wild. The loader
 * surfaces them flattened + ready for the runner to merge with the
 * synthetic query set.
 *
 * The file is hand-edited on purpose — no CLI command for adding
 * entries — to keep the loop friction-free once the operator knows
 * the file path. Per plan §Key Decision (regressions).
 */

import { readFile } from "node:fs/promises"

import { z } from "zod"

import { regressionsPath } from "./paths"
import type { QuerySource } from "./types"

export const REGRESSION_ENTRY_SCHEMA = z.object({
  locale: z.string().min(1),
  query: z.string().min(1),
  notes: z.string().optional(),
  addedAt: z.string().optional(),
  addedBy: z.string().optional(),
})

export const REGRESSION_FILE_SCHEMA = z.object({
  entries: z.array(REGRESSION_ENTRY_SCHEMA),
})

export type RegressionEntry = z.infer<typeof REGRESSION_ENTRY_SCHEMA>

export type LoadedRegressionQuery = {
  locale: string
  query: string
  source: QuerySource
  notes?: string
}

export class RegressionLoadError extends Error {
  constructor(
    readonly code: "not_found" | "invalid_json" | "validation",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "RegressionLoadError"
  }
}

export type LoadRegressionsOptions = {
  /** Override path for tests. Defaults to `apps/admin/eval/regressions.json`. */
  filePath?: string
  /** Treat ENOENT as `entries: []` rather than throwing. Default `true`
   *  because the file is optional — operators may not have authored
   *  any regressions yet. */
  allowMissing?: boolean
}

export async function loadRegressions(
  options: LoadRegressionsOptions = {},
): Promise<LoadedRegressionQuery[]> {
  const filePath = options.filePath ?? regressionsPath()
  const allowMissing = options.allowMissing ?? true

  let raw: string
  try {
    raw = await readFile(filePath, "utf8")
  } catch (cause) {
    if (
      allowMissing &&
      cause instanceof Error &&
      "code" in cause &&
      (cause as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return []
    }
    throw new RegressionLoadError(
      "not_found",
      `regression file not found at ${filePath}`,
      cause,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new RegressionLoadError(
      "invalid_json",
      `regression file at ${filePath} is not valid JSON`,
      cause,
    )
  }

  const validated = REGRESSION_FILE_SCHEMA.safeParse(parsed)
  if (!validated.success) {
    throw new RegressionLoadError(
      "validation",
      `regression file at ${filePath} failed schema validation: ${validated.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")}`,
    )
  }

  return validated.data.entries.map<LoadedRegressionQuery>((entry) => ({
    locale: entry.locale,
    query: entry.query,
    source: "regression",
    notes: entry.notes,
  }))
}
