import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { env, getMastraStorageDir } from "../../config/env"
import { repoRoot } from "./repo-root"
import {
  DEVOTIONAL_BLOCKS,
  MAX_DEVOTIONAL_QUESTIONS,
  MAX_DEVOTIONAL_REASONS,
  MAX_DEVOTIONAL_SHORT_TEXT,
  MAX_DEVOTIONAL_TEXT_LENGTH,
  MAX_DEVOTIONAL_URL,
  VIDEO_MATCH_SOURCES,
  type DevotionalReport,
} from "./types"

const SAFE_ARTIFACT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

export const HookSchema = z
  .object({
    type: z.enum(["news", "holiday", "question"]),
    title: z.string().max(MAX_DEVOTIONAL_SHORT_TEXT),
    summary: z.string().max(MAX_DEVOTIONAL_SHORT_TEXT),
    sourceUrl: z.string().max(MAX_DEVOTIONAL_URL).nullable(),
  })
  .strict()

export const ScriptureRefSchema = z
  .object({
    reference: z.string().max(MAX_DEVOTIONAL_SHORT_TEXT),
    text: z.string().max(MAX_DEVOTIONAL_TEXT_LENGTH),
    translation: z.string().max(MAX_DEVOTIONAL_SHORT_TEXT).nullable(),
    needsCanonicalSource: z.boolean(),
  })
  .strict()

export const VideoClipSchema = z
  .object({
    videoId: z.string().max(MAX_DEVOTIONAL_SHORT_TEXT),
    title: z.string().max(MAX_DEVOTIONAL_SHORT_TEXT),
    url: z.string().max(MAX_DEVOTIONAL_URL),
    thumbnailUrl: z.string().max(MAX_DEVOTIONAL_URL).nullable(),
  })
  .strict()

export const DevotionalSchema = z
  .object({
    date: z.string().max(64),
    hook: HookSchema,
    scripture: ScriptureRefSchema,
    video: VideoClipSchema.nullable(),
    videoMatch: z.enum(VIDEO_MATCH_SOURCES),
    reflection: z.string().max(MAX_DEVOTIONAL_TEXT_LENGTH),
    questions: z
      .array(z.string().max(MAX_DEVOTIONAL_SHORT_TEXT))
      .max(MAX_DEVOTIONAL_QUESTIONS),
    furtherReading: z.string().max(MAX_DEVOTIONAL_URL).nullable(),
    blockOrder: z
      .array(z.enum(DEVOTIONAL_BLOCKS))
      .max(DEVOTIONAL_BLOCKS.length),
  })
  .strict()

export const SafetyVerdictSchema = z
  .object({
    verdict: z.enum(["pass", "block"]),
    scores: z
      .object({
        doctrine: z.number(),
        tone: z.number(),
        sensitivity: z.number(),
      })
      .strict(),
    reasons: z
      .array(z.string().max(MAX_DEVOTIONAL_SHORT_TEXT))
      .max(MAX_DEVOTIONAL_REASONS),
  })
  .strict()

export const VoiceoverInfoSchema = z
  .object({
    format: z.literal("mp3"),
    voice: z.string().max(MAX_DEVOTIONAL_SHORT_TEXT),
    locale: z.string().max(64),
    characterCount: z.number().int().nonnegative(),
    artifactPath: z.string().max(MAX_DEVOTIONAL_URL),
  })
  .strict()

export const DevotionalReportSchema = z
  .object({
    schemaVersion: z.literal("1"),
    kind: z.literal("daily-devotional"),
    reportId: z.string().max(128),
    mastraRunId: z.string().max(128),
    date: z.string().max(64),
    startedAt: z.string().max(64),
    finishedAt: z.string().max(64),
    published: z.boolean(),
    videoMatch: z.enum(VIDEO_MATCH_SOURCES),
    safety: SafetyVerdictSchema.nullable(),
    devotional: DevotionalSchema.nullable(),
    // Optional + nullable so reports written before voiceover existed still
    // validate on read (back-compat); new runs always set it (audio or null).
    voiceover: VoiceoverInfoSchema.nullable().optional(),
  })
  .strict()

export class DevotionalArtifactError extends Error {
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
    this.name = "DevotionalArtifactError"
  }
}

export type DevotionalArtifactStore = {
  readonly rootDir: string
  writeReport: (report: DevotionalReport) => Promise<{ path: string }>
  readReport: (reportId: string) => Promise<DevotionalReport>
  /**
   * Persist narration audio bytes. Returns both the absolute path and a stable
   * store-relative path (`audio/<reportId>.mp3`) for the report's
   * `voiceover.artifactPath`.
   */
  writeAudio: (
    reportId: string,
    bytes: Uint8Array,
  ) => Promise<{ path: string; relativePath: string }>
}

export function devotionalArtifactRoot(): string {
  if (env.DEVOTIONAL_ARTIFACT_DIR) return env.DEVOTIONAL_ARTIFACT_DIR
  // A RELATIVE storage dir must resolve to ONE place for every process — the
  // dev server (cwd src/mastra/public), spawned renders (cwd repo root), CLI
  // scripts, and vitest all share the ledger/reports. Anchor it to the repo
  // root; absolute dirs (Railway volume, explicit env) are used as-is.
  const storageDir = getMastraStorageDir()
  const anchored = path.isAbsolute(storageDir)
    ? storageDir
    : path.join(repoRoot(), storageDir)
  return path.join(anchored, "daily-devotional")
}

function assertSafeName(name: string): string {
  const normalized = name.trim()
  if (
    normalized.length === 0 ||
    normalized.includes("..") ||
    path.basename(normalized) !== normalized ||
    !SAFE_ARTIFACT_NAME.test(normalized)
  ) {
    throw new DevotionalArtifactError(
      "invalid_name",
      "artifact name must be a safe slug",
    )
  }
  return normalized
}

function reportPath(rootDir: string, reportId: string): string {
  return path.join(rootDir, "reports", `${assertSafeName(reportId)}.json`)
}

function audioRelativePath(reportId: string): string {
  return path.posix.join("audio", `${assertSafeName(reportId)}.mp3`)
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
    throw new DevotionalArtifactError(
      "write_failed",
      "failed to write devotional artifact",
      cause,
    )
  }
}

async function writeBytes(filePath: string, bytes: Uint8Array): Promise<void> {
  const dir = path.dirname(filePath)
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(tmpPath, bytes)
    await rename(tmpPath, filePath)
  } catch (cause) {
    await rm(tmpPath, { force: true }).catch(() => undefined)
    throw new DevotionalArtifactError(
      "write_failed",
      "failed to write devotional audio artifact",
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

export function createDevotionalArtifactStore(
  rootDir = devotionalArtifactRoot(),
): DevotionalArtifactStore {
  return {
    rootDir,
    async writeReport(report) {
      const parsed = DevotionalReportSchema.safeParse(report)
      if (!parsed.success) {
        throw new DevotionalArtifactError(
          "invalid_artifact",
          "devotional report failed artifact validation",
          parsed.error,
        )
      }
      const filePath = reportPath(rootDir, report.reportId)
      await writeJson(filePath, parsed.data)
      return { path: filePath }
    },
    async writeAudio(reportId, bytes) {
      const relativePath = audioRelativePath(reportId)
      const filePath = path.join(rootDir, relativePath)
      await writeBytes(filePath, bytes)
      return { path: filePath, relativePath }
    },
    async readReport(reportId) {
      const filePath = reportPath(rootDir, reportId)
      let text: string
      try {
        text = await readFile(filePath, "utf8")
      } catch (cause) {
        if (!isNodeErrorCode(cause, "ENOENT")) {
          throw new DevotionalArtifactError(
            "read_failed",
            `report '${reportId}' could not be read`,
            cause,
          )
        }
        throw new DevotionalArtifactError(
          "not_found",
          `report '${reportId}' was not found`,
          cause,
        )
      }

      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch (cause) {
        throw new DevotionalArtifactError(
          "invalid_artifact",
          `report '${reportId}' is not valid JSON`,
          cause,
        )
      }
      const parsed = DevotionalReportSchema.safeParse(payload)
      if (!parsed.success) {
        throw new DevotionalArtifactError(
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
