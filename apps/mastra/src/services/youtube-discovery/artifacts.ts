import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { getMastraStorageDir } from "../../config/env"
import { YOUTUBE_SEARCH_ERROR_CODES } from "../youtube-search-client"
import type { YouTubeDiscoveryReport } from "./types"

const SAFE_ARTIFACT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/
const MAX_VIDEOS = 200
const MAX_QUERIES = 20
const MAX_CHANNELS = 50
const MAX_PLAYLISTS = 50
const MAX_SOURCE_FAILURES = 120
const MAX_HASHTAGS = 30
const MAX_SAFE_TEXT = 1024
const MAX_URL = 512
const MAX_SHORT_TEXT = 256

export const YouTubeVideoSchema = z
  .object({
    videoId: z.string().max(128),
    url: z.string().max(MAX_URL),
    title: z.string().max(MAX_SHORT_TEXT),
    description: z.string().max(MAX_SAFE_TEXT),
    channelId: z.string().max(MAX_SHORT_TEXT).nullable(),
    channelTitle: z.string().max(MAX_SHORT_TEXT).nullable(),
    authorUrl: z.string().max(MAX_URL).nullable(),
    publishedAt: z.string().max(64).nullable(),
    thumbnailUrl: z.string().max(MAX_URL).nullable(),
    hashtags: z.array(z.string().max(128)).max(MAX_HASHTAGS),
    matchedAi: z.array(z.string().max(64)).max(64),
    matchedChristian: z.array(z.string().max(64)).max(64),
  })
  .strict()

export const DiscoverySourceFailureSchema = z
  .object({
    source: z.string().max(MAX_SAFE_TEXT),
    kind: z.enum(["channel", "playlist", "query"]),
    code: z.enum([...YOUTUBE_SEARCH_ERROR_CODES, "source_failed"]),
    message: z.string().max(MAX_SAFE_TEXT),
  })
  .strict()

export const YouTubeDiscoveryTotalsSchema = z
  .object({
    candidates: z.number().int().nonnegative(),
    videos: z.number().int().nonnegative(),
    deduped: z.number().int().nonnegative(),
    excludedCommentary: z.number().int().nonnegative(),
    qualified: z.number().int().nonnegative(),
  })
  .strict()

export const YouTubeDiscoveryReportSchema = z
  .object({
    schemaVersion: z.literal("1"),
    kind: z.literal("youtube-ai-christian-discovery"),
    reportId: z.string().max(128),
    mastraRunId: z.string().max(128),
    startedAt: z.string().max(64),
    finishedAt: z.string().max(64),
    channels: z.array(z.string().max(MAX_SAFE_TEXT)).max(MAX_CHANNELS),
    playlists: z.array(z.string().max(MAX_SAFE_TEXT)).max(MAX_PLAYLISTS),
    queries: z.array(z.string().max(MAX_SAFE_TEXT)).max(MAX_QUERIES),
    totals: YouTubeDiscoveryTotalsSchema,
    sourceFailures: z
      .array(DiscoverySourceFailureSchema)
      .max(MAX_SOURCE_FAILURES),
    videos: z.array(YouTubeVideoSchema).max(MAX_VIDEOS),
  })
  .strict()

export class YouTubeDiscoveryArtifactError extends Error {
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
    this.name = "YouTubeDiscoveryArtifactError"
  }
}

export type YouTubeDiscoveryArtifactStore = {
  readonly rootDir: string
  writeReport: (report: YouTubeDiscoveryReport) => Promise<{ path: string }>
  readReport: (reportId: string) => Promise<YouTubeDiscoveryReport>
}

export function youtubeDiscoveryArtifactRoot(): string {
  return path.join(getMastraStorageDir(), "youtube-discovery")
}

function assertSafeName(name: string): string {
  const normalized = name.trim()
  if (
    normalized.length === 0 ||
    normalized.includes("..") ||
    path.basename(normalized) !== normalized ||
    !SAFE_ARTIFACT_NAME.test(normalized)
  ) {
    throw new YouTubeDiscoveryArtifactError(
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
    throw new YouTubeDiscoveryArtifactError(
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

export function createYouTubeDiscoveryArtifactStore(
  rootDir = youtubeDiscoveryArtifactRoot(),
): YouTubeDiscoveryArtifactStore {
  return {
    rootDir,
    async writeReport(report) {
      const parsed = YouTubeDiscoveryReportSchema.safeParse(report)
      if (!parsed.success) {
        throw new YouTubeDiscoveryArtifactError(
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
          throw new YouTubeDiscoveryArtifactError(
            "read_failed",
            `report '${reportId}' could not be read`,
            cause,
          )
        }
        throw new YouTubeDiscoveryArtifactError(
          "not_found",
          `report '${reportId}' was not found`,
          cause,
        )
      }

      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch (cause) {
        throw new YouTubeDiscoveryArtifactError(
          "invalid_artifact",
          `report '${reportId}' is not valid JSON`,
          cause,
        )
      }
      const parsed = YouTubeDiscoveryReportSchema.safeParse(payload)
      if (!parsed.success) {
        throw new YouTubeDiscoveryArtifactError(
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
