import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveReportOutPath, writeReportToPath } from "./run-embeds"

// feat-119 PR1 — `--report-out=<path>` flag tests. The path-resolve
// helper is pure; the file-write helper is async + I/O-bound, so use a
// real tmp dir per-test to avoid cross-test races.

describe("resolveReportOutPath", () => {
  it("returns undefined when the arg is unset", () => {
    expect(resolveReportOutPath(undefined)).toBeUndefined()
  })

  it("returns undefined when the arg is the empty string", () => {
    // `--report-out=` (no value) should NOT be treated as a request to
    // write a file — guards against an operator typing the flag with
    // no value and getting a write to `cwd()`.
    expect(resolveReportOutPath("")).toBeUndefined()
  })

  it("returns absolute paths verbatim", () => {
    const abs = "/tmp/some/where/report.json"
    expect(resolveReportOutPath(abs)).toBe(abs)
  })

  it("anchors relative paths to process.cwd()", () => {
    const rel = ".tmp/report.json"
    expect(resolveReportOutPath(rel)).toBe(resolve(process.cwd(), rel))
  })

  it("anchors relative paths with parent traversal correctly", () => {
    const rel = "../sibling-report.json"
    const result = resolveReportOutPath(rel)
    expect(result).toBe(resolve(process.cwd(), rel))
    // Sanity: no double-slash, no preserved `..` segment.
    expect(result?.includes("..")).toBe(false)
  })
})

describe("writeReportToPath", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "run-embeds-test-"))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("writes the JSON-stringified report to the path", async () => {
    const path = join(tmpDir, "report.json")
    const report = {
      event: "run-embeds.complete",
      pipeline: "scene",
      reports: {
        scene: { totalTargets: 3, succeeded: 3, missingArtifacts: [] },
      },
    }

    const result = await writeReportToPath(path, report)
    expect(result).toEqual({ ok: true })

    const written = await readFile(path, "utf8")
    // Trailing newline is part of the contract.
    expect(written.endsWith("\n")).toBe(true)
    expect(JSON.parse(written)).toEqual(report)
  })

  it("creates parent directories recursively when missing", async () => {
    const path = join(tmpDir, "nested", "deeper", "report.json")
    const report = { event: "run-embeds.complete", pipeline: "transcript" }

    const result = await writeReportToPath(path, report)
    expect(result).toEqual({ ok: true })

    const written = await readFile(path, "utf8")
    expect(JSON.parse(written)).toEqual(report)
  })

  it("returns ok:false with the error message when the path is invalid", async () => {
    // Inside the tmp dir, the parent we want to write into is itself
    // a regular FILE rather than a directory — so writing to
    // `<tmp>/notadir/inside.json` triggers ENOTDIR, which is a real
    // failure mode operators could hit if they mistype the path.
    const fileAsDir = join(tmpDir, "notadir")
    await import("node:fs/promises").then((fs) => fs.writeFile(fileAsDir, "x"))
    const path = join(fileAsDir, "inside.json")

    const result = await writeReportToPath(path, { event: "x" })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Assert the original errno token reaches the caller — guards
      // against a refactor that swallows the underlying error and
      // substitutes a generic placeholder. The exact code varies by
      // platform: macOS surfaces ENOTDIR ("not a directory"); Linux's
      // mkdir surfaces EEXIST ("file already exists, mkdir ...") when
      // the intermediate path component is a regular file. Either
      // token proves the original error provenance is preserved.
      expect(result.error).toMatch(/ENOTDIR|EEXIST|not a directory/i)
    }
  })

  it("preserves the report shape — operator can JSON.parse the file end-to-end", async () => {
    // PR2's `pnpm trigger-enrichment --from-report=<path>` will parse
    // this file. Lock in that the JSON shape round-trips exactly so
    // a future contract change here is a deliberate breaking choice.
    const path = join(tmpDir, "round-trip.json")
    const report = {
      event: "run-embeds.complete",
      pipeline: "both",
      wallClockMs: 12345,
      reports: {
        scene: {
          totalTargets: 12,
          succeeded: 10,
          skipped: 2,
          failed: 0,
          missingArtifacts: [
            { assetId: 790, coreId: "2_0-Crushing", kind: "scene-analysis" },
          ],
        },
        transcript: {
          totalTargets: 12,
          succeeded: 11,
          skipped: 1,
          failed: 0,
          missingArtifacts: [
            { assetId: 790, coreId: "2_0-Crushing", kind: "transcript" },
          ],
        },
      },
    }

    await writeReportToPath(path, report)
    const written = await readFile(path, "utf8")
    expect(JSON.parse(written)).toEqual(report)
  })
})
