/**
 * Baseline load / save / filtering for the eval harness.
 *
 * A baseline is a frozen snapshot of `(queries, top-K results,
 * content fingerprint)` for a known-good search state. Re-baselining
 * is an explicit operator command — never automatic — so an
 * accepted improvement becomes the new bar.
 *
 * Persisted at `apps/admin/eval/baselines/{name}.json`. Default name
 * is `default`; multiple named baselines are allowed but not
 * required.
 *
 * Drift comparison delegates to `fingerprint.ts::compareFingerprints`.
 * Plan §Unit 7.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { compareFingerprints } from "./fingerprint"
import type { Baseline, DriftResult, Fingerprint } from "./types"

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

const FingerprintSchema = z.object({
  count: z.number().int().min(0),
  maxUpdatedAt: z.string().nullable(),
})

const BaselineSchema = z.object({
  schemaVersion: z.literal("1"),
  name: z.string().min(1),
  capturedAt: z.string(),
  gitSha: z.string(),
  contentFingerprint: z.object({
    sceneEmbeddings: FingerprintSchema,
    transcriptEmbeddings: FingerprintSchema,
    experiences: FingerprintSchema,
  }),
  queries: z.array(
    z.object({
      locale: z.string().min(1),
      query: z.string().min(1),
      source: z.enum(["synthetic", "regression"]),
      results: z.array(SearchResultSchema),
    }),
  ),
})

export class BaselineNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BaselineNotFoundError"
  }
}

export class BaselineSchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BaselineSchemaError"
  }
}

export type BaselineFilesystem = {
  /** Directory that holds `{name}.json` baseline files. Override for
   *  tests. Defaults to `apps/admin/eval/baselines/`. */
  directory?: string
}

function defaultDirectory(): string {
  return path.resolve(process.cwd(), "apps/admin/eval/baselines")
}

function pathFor(name: string, directory?: string): string {
  return path.join(directory ?? defaultDirectory(), `${name}.json`)
}

/** Load a committed baseline by name. Throws `BaselineNotFoundError`
 *  on ENOENT and `BaselineSchemaError` on schema-mismatch. */
export async function loadBaseline(
  name = "default",
  fs: BaselineFilesystem = {},
): Promise<Baseline> {
  const filePath = pathFor(name, fs.directory)
  let raw: string
  try {
    raw = await readFile(filePath, "utf8")
  } catch (cause) {
    if (
      cause instanceof Error &&
      "code" in cause &&
      (cause as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new BaselineNotFoundError(
        `baseline "${name}" not found at ${filePath} — run \`eval:search:rebaseline\` to capture one`,
      )
    }
    throw cause
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new BaselineSchemaError(
      `baseline file ${filePath} is not valid JSON: ${(cause as Error).message}`,
    )
  }

  const validated = BaselineSchema.safeParse(parsed)
  if (!validated.success) {
    throw new BaselineSchemaError(
      `baseline file ${filePath} failed schema validation: ${validated.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")}`,
    )
  }

  return validated.data
}

/** Save a baseline atomically (.tmp + rename) so a crash mid-write
 *  never leaves a half-written file. */
export async function saveBaseline(
  baseline: Baseline,
  fs: BaselineFilesystem = {},
): Promise<{ path: string }> {
  const directory = fs.directory ?? defaultDirectory()
  await mkdir(directory, { recursive: true })

  // Validate before write — same Zod schema used on read. Catches
  // type-erased construction bugs at save time, never silently writes
  // a baseline that wouldn't load.
  const validated = BaselineSchema.parse(baseline)

  const filePath = pathFor(baseline.name, directory)
  const tmpPath = `${filePath}.tmp`
  await writeFile(tmpPath, JSON.stringify(validated, null, 2) + "\n", "utf8")
  await rename(tmpPath, filePath)
  return { path: filePath }
}

export type RunFilter =
  | { mode: "quick"; quickLocales: readonly string[] }
  | { mode: "full" }
  | { mode: "locale"; locale: string }

/** Filter the baseline's queries down to the set this run cares
 *  about. Returns the same shape the runner can iterate.
 *
 *  - `quick`: only queries whose locale is in `quickLocales`.
 *  - `full`: every query.
 *  - `locale`: only queries matching that single locale. */
export function getQueriesForRun(
  baseline: Baseline,
  filter: RunFilter,
): Baseline["queries"] {
  switch (filter.mode) {
    case "quick": {
      const allowed = new Set(filter.quickLocales)
      return baseline.queries.filter((q) => allowed.has(q.locale))
    }
    case "full":
      return baseline.queries
    case "locale":
      return baseline.queries.filter((q) => q.locale === filter.locale)
  }
}

/** Drift between baseline and current fingerprints. Wraps
 *  `compareFingerprints` so consumers don't have to import two
 *  modules to do the obvious thing. */
export function detectDrift(
  baseline: Baseline,
  currentFingerprint: Fingerprint,
): DriftResult {
  return compareFingerprints(baseline.contentFingerprint, currentFingerprint)
}
