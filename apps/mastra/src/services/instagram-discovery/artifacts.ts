import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { env, getMastraStorageDir } from "../../config/env"
import { FIRECRAWL_SEARCH_ERROR_CODES } from "../firecrawl-search-client"
import type { DiscoveryReport } from "./types"

const SAFE_ARTIFACT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/
const MAX_POSTS = 200
const MAX_QUERIES = 20
const MAX_QUERY_FAILURES = 70
const MAX_HASHTAGS = 30
const MAX_SAFE_TEXT = 1024
const MAX_URL = 512
const MAX_SHORT_TEXT = 256

export const InstagramPostSchema = z
  .object({
    url: z.string().max(MAX_URL),
    shortcode: z.string().max(128),
    mediaType: z.enum(["post", "reel", "tv"]),
    authorHandle: z.string().max(MAX_SHORT_TEXT).nullable(),
    authorName: z.string().max(MAX_SHORT_TEXT).nullable(),
    caption: z.string().max(MAX_SAFE_TEXT),
    hashtags: z.array(z.string().max(128)).max(MAX_HASHTAGS),
    publishedAt: z.string().max(64).nullable(),
    thumbnailUrl: z.string().max(MAX_URL).nullable(),
    matchedAi: z.array(z.string().max(64)).max(64),
    matchedChristian: z.array(z.string().max(64)).max(64),
  })
  .strict()

export const DiscoveryQueryFailureSchema = z
  .object({
    query: z.string().max(MAX_SAFE_TEXT),
    code: z.enum([...FIRECRAWL_SEARCH_ERROR_CODES, "search_failed"]),
    message: z.string().max(MAX_SAFE_TEXT),
  })
  .strict()

export const DiscoveryTotalsSchema = z
  .object({
    candidates: z.number().int().nonnegative(),
    instagram: z.number().int().nonnegative(),
    deduped: z.number().int().nonnegative(),
    excludedCommentary: z.number().int().nonnegative(),
    qualified: z.number().int().nonnegative(),
  })
  .strict()

export const DiscoveryReportSchema = z
  .object({
    schemaVersion: z.literal("1"),
    kind: z.literal("instagram-ai-christian-discovery"),
    reportId: z.string().max(128),
    mastraRunId: z.string().max(128),
    startedAt: z.string().max(64),
    finishedAt: z.string().max(64),
    queries: z.array(z.string().max(MAX_SAFE_TEXT)).max(MAX_QUERIES),
    totals: DiscoveryTotalsSchema,
    queryFailures: z.array(DiscoveryQueryFailureSchema).max(MAX_QUERY_FAILURES),
    posts: z.array(InstagramPostSchema).max(MAX_POSTS),
  })
  .strict()

export class InstagramDiscoveryArtifactError extends Error {
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
    this.name = "InstagramDiscoveryArtifactError"
  }
}

export type InstagramDiscoveryArtifactStore = {
  readonly rootDir: string
  writeReport: (report: DiscoveryReport) => Promise<{ path: string }>
  readReport: (reportId: string) => Promise<DiscoveryReport>
}

export function instagramDiscoveryArtifactRoot(): string {
  return (
    env.INSTAGRAM_DISCOVERY_ARTIFACT_DIR ??
    path.join(getMastraStorageDir(), "instagram-discovery")
  )
}

function assertSafeName(name: string): string {
  const normalized = name.trim()
  if (
    normalized.length === 0 ||
    normalized.includes("..") ||
    path.basename(normalized) !== normalized ||
    !SAFE_ARTIFACT_NAME.test(normalized)
  ) {
    throw new InstagramDiscoveryArtifactError(
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
  // randomUUID (not Date.now) so concurrent writers in the same process at the
  // same millisecond cannot collide on the tmp path before the atomic rename.
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
    throw new InstagramDiscoveryArtifactError(
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

export function createInstagramDiscoveryArtifactStore(
  rootDir = instagramDiscoveryArtifactRoot(),
): InstagramDiscoveryArtifactStore {
  return {
    rootDir,
    async writeReport(report) {
      const parsed = DiscoveryReportSchema.safeParse(report)
      if (!parsed.success) {
        throw new InstagramDiscoveryArtifactError(
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
          throw new InstagramDiscoveryArtifactError(
            "read_failed",
            `report '${reportId}' could not be read`,
            cause,
          )
        }
        throw new InstagramDiscoveryArtifactError(
          "not_found",
          `report '${reportId}' was not found`,
          cause,
        )
      }

      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch (cause) {
        throw new InstagramDiscoveryArtifactError(
          "invalid_artifact",
          `report '${reportId}' is not valid JSON`,
          cause,
        )
      }
      const parsed = DiscoveryReportSchema.safeParse(payload)
      if (!parsed.success) {
        throw new InstagramDiscoveryArtifactError(
          "invalid_artifact",
          `report '${reportId}' failed artifact validation`,
          parsed.error,
        )
      }
      return parsed.data
    },
  }
}

export const _internals = {
  assertSafeName,
  reportPath,
}
