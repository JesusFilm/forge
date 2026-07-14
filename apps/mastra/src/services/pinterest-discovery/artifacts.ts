import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { getMastraStorageDir } from "../../config/env"
import { PINTEREST_SEARCH_ERROR_CODES } from "../pinterest-search-client"
import type { PinterestDiscoveryReport } from "./types"

const SAFE_ARTIFACT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/
const MAX_PINS = 300
const MAX_BOARDS = 50
const MAX_BOARD_FAILURES = 50
const MAX_HASHTAGS = 30
const MAX_SAFE_TEXT = 1024
const MAX_URL = 512
const MAX_SHORT_TEXT = 256

export const PinterestPinSchema = z
  .object({
    pinId: z.string().max(128),
    url: z.string().max(MAX_URL),
    caption: z.string().max(MAX_SAFE_TEXT),
    thumbnailUrl: z.string().max(MAX_URL).nullable(),
    publishedAt: z.string().max(64).nullable(),
    boardName: z.string().max(MAX_SHORT_TEXT).nullable(),
    boardUrl: z.string().max(MAX_URL).nullable(),
    hashtags: z.array(z.string().max(128)).max(MAX_HASHTAGS),
    matchedAi: z.array(z.string().max(64)).max(64),
    matchedChristian: z.array(z.string().max(64)).max(64),
  })
  .strict()

export const BoardFailureSchema = z
  .object({
    board: z.string().max(MAX_URL),
    code: z.enum([...PINTEREST_SEARCH_ERROR_CODES, "board_failed"]),
    message: z.string().max(MAX_SAFE_TEXT),
  })
  .strict()

export const PinterestDiscoveryTotalsSchema = z
  .object({
    candidates: z.number().int().nonnegative(),
    pins: z.number().int().nonnegative(),
    deduped: z.number().int().nonnegative(),
    excludedCommentary: z.number().int().nonnegative(),
    qualified: z.number().int().nonnegative(),
  })
  .strict()

export const PinterestDiscoveryReportSchema = z
  .object({
    schemaVersion: z.literal("1"),
    kind: z.literal("pinterest-ai-christian-discovery"),
    reportId: z.string().max(128),
    mastraRunId: z.string().max(128),
    startedAt: z.string().max(64),
    finishedAt: z.string().max(64),
    boards: z.array(z.string().max(MAX_URL)).max(MAX_BOARDS),
    totals: PinterestDiscoveryTotalsSchema,
    boardFailures: z.array(BoardFailureSchema).max(MAX_BOARD_FAILURES),
    pins: z.array(PinterestPinSchema).max(MAX_PINS),
  })
  .strict()

export class PinterestDiscoveryArtifactError extends Error {
  constructor(
    readonly code:
      | "invalid_name"
      | "not_found"
      | "read_failed"
      | "write_failed"
      | "invalid_artifact",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "PinterestDiscoveryArtifactError"
  }
}

export type PinterestDiscoveryArtifactStore = {
  readonly rootDir: string
  writeReport: (report: PinterestDiscoveryReport) => Promise<{ path: string }>
  readReport: (reportId: string) => Promise<PinterestDiscoveryReport>
}

export function pinterestDiscoveryArtifactRoot(): string {
  return path.join(getMastraStorageDir(), "pinterest-discovery")
}

function assertSafeName(name: string): string {
  const normalized = name.trim()
  if (
    normalized.length === 0 ||
    normalized.includes("..") ||
    path.basename(normalized) !== normalized ||
    !SAFE_ARTIFACT_NAME.test(normalized)
  ) {
    throw new PinterestDiscoveryArtifactError(
      "invalid_name",
      "artifact name must be a safe slug",
    )
  }
  return normalized
}

function reportPath(rootDir: string, reportId: string): string {
  return path.join(rootDir, "reports", `${assertSafeName(reportId)}.json`)
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath)
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(tmpPath, JSON.stringify(value, null, 2) + "\n", "utf8")
    await rename(tmpPath, filePath)
  } catch (cause) {
    await rm(tmpPath, { force: true }).catch(() => undefined)
    throw new PinterestDiscoveryArtifactError(
      "write_failed",
      "failed to write discovery artifact",
      cause,
    )
  }
}

function isNodeErrorCode(cause: unknown, code: string): boolean {
  return (
    cause != null &&
    typeof cause === "object" &&
    "code" in cause &&
    (cause as { code?: unknown }).code === code
  )
}

export function createPinterestDiscoveryArtifactStore(
  rootDir = pinterestDiscoveryArtifactRoot(),
): PinterestDiscoveryArtifactStore {
  return {
    rootDir,
    async writeReport(report) {
      const parsed = PinterestDiscoveryReportSchema.safeParse(report)
      if (!parsed.success) {
        throw new PinterestDiscoveryArtifactError(
          "invalid_artifact",
          "discovery report failed artifact validation",
          parsed.error,
        )
      }
      const filePath = reportPath(rootDir, report.reportId)
      await writeJson(filePath, parsed.data)
      return { path: filePath }
    },
    async readReport(reportId) {
      const filePath = reportPath(rootDir, reportId)
      let text: string
      try {
        text = await readFile(filePath, "utf8")
      } catch (cause) {
        if (!isNodeErrorCode(cause, "ENOENT")) {
          throw new PinterestDiscoveryArtifactError(
            "read_failed",
            `report '${reportId}' could not be read`,
            cause,
          )
        }
        throw new PinterestDiscoveryArtifactError(
          "not_found",
          `report '${reportId}' was not found`,
          cause,
        )
      }
      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch (cause) {
        throw new PinterestDiscoveryArtifactError(
          "invalid_artifact",
          `report '${reportId}' is not valid JSON`,
          cause,
        )
      }
      const parsed = PinterestDiscoveryReportSchema.safeParse(payload)
      if (!parsed.success) {
        throw new PinterestDiscoveryArtifactError(
          "invalid_artifact",
          `report '${reportId}' failed artifact validation`,
          parsed.error,
        )
      }
      return parsed.data
    },
  }
}

export const _internals = { assertSafeName, reportPath }
