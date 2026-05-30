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

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { compareFingerprints } from "./fingerprint"
import { baselinesDir } from "./paths"
import { FingerprintSchema, SearchResultSchema } from "./schemas"
import type { Baseline, DriftResult, Fingerprint } from "./types"

const BaselineSchema = z.object({
  schemaVersion: z.literal("1"),
  name: z.string().min(1),
  capturedAt: z.string(),
  gitSha: z.string(),
  contentFingerprint: FingerprintSchema,
  queries: z.array(
    z.object({
      locale: z.string().min(1),
      query: z.string().min(1),
      source: z.enum(["synthetic", "regression", "promoted"]),
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

function pathFor(name: string, directory?: string): string {
  return path.join(directory ?? baselinesDir(), `${name}.json`)
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
  const directory = fs.directory ?? baselinesDir()
  await mkdir(directory, { recursive: true })

  // Validate before write — same Zod schema used on read. Catches
  // type-erased construction bugs at save time, never silently writes
  // a baseline that wouldn't load.
  const validated = BaselineSchema.parse(baseline)

  const filePath = pathFor(baseline.name, directory)
  const tmpPath = `${filePath}.tmp`
  await writeFile(tmpPath, JSON.stringify(validated, null, 2) + "\n", "utf8")
  try {
    await rename(tmpPath, filePath)
  } catch (cause) {
    // Clean up the orphaned .tmp before bubbling the rename failure.
    // unlink errors are swallowed — the rename failure is the
    // operator-relevant signal; the .tmp will be cleaned up on the
    // next successful save.
    await unlink(tmpPath).catch(() => undefined)
    throw cause
  }
  return { path: filePath }
}

// Query filtering by run-mode lives in `runner.ts::filterQueries` —
// this module deliberately doesn't duplicate it.

/** Drift between baseline and current fingerprints. Wraps
 *  `compareFingerprints` so consumers don't have to import two
 *  modules to do the obvious thing. */
export function detectDrift(
  baseline: Baseline,
  currentFingerprint: Fingerprint,
): DriftResult {
  return compareFingerprints(baseline.contentFingerprint, currentFingerprint)
}
