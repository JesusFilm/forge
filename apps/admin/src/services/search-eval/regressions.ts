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

import {
  SearchEvalCandidatePromotionStatus,
  SearchEvalCandidateSanitizationStatus,
  type PrismaClient,
} from "@prisma/client"
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
  promotedCandidateId?: string
  sourceAnchors?: unknown
  reviewerIdentity?: string
  promotedAt?: string
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
  /** Optional Admin DB client. When supplied, promoted sanitized candidates
   *  are appended after hand-edited regressions. */
  prisma?: PrismaClient
  /** Treat ENOENT as `entries: []` rather than throwing. Default `true`
   *  because the file is optional — operators may not have authored
   *  any regressions yet. */
  allowMissing?: boolean
}

export async function loadPromotedRegressions(
  prisma: PrismaClient,
): Promise<LoadedRegressionQuery[]> {
  const rows = await prisma.searchEvalCandidate.findMany({
    where: {
      promotionStatus: SearchEvalCandidatePromotionStatus.PROMOTED,
      sanitizationStatus: SearchEvalCandidateSanitizationStatus.SANITIZED,
      sanitizedQueryText: { not: null },
    },
    orderBy: [{ promotedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      locale: true,
      sanitizedQueryText: true,
      sanitizedExpectedResultNotes: true,
      sanitizedSourceAnchors: true,
      reviewerIdentity: true,
      promotedAt: true,
    },
  })

  return rows.flatMap((row) => {
    if (!row.sanitizedQueryText) return []
    return [
      {
        locale: row.locale,
        query: row.sanitizedQueryText,
        source: "promoted" as const,
        notes: row.sanitizedExpectedResultNotes ?? undefined,
        promotedCandidateId: row.id,
        sourceAnchors: row.sanitizedSourceAnchors,
        reviewerIdentity: row.reviewerIdentity ?? undefined,
        promotedAt: row.promotedAt?.toISOString(),
      },
    ]
  })
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
      return options.prisma ? loadPromotedRegressions(options.prisma) : []
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

  const fileEntries = validated.data.entries.map<LoadedRegressionQuery>(
    (entry) => ({
      locale: entry.locale,
      query: entry.query,
      source: "regression",
      notes: entry.notes,
    }),
  )
  if (!options.prisma) return fileEntries

  return [...fileEntries, ...(await loadPromotedRegressions(options.prisma))]
}
