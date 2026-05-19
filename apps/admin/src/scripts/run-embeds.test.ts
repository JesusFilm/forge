import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  RunEmbedsConfigError,
  extractFailedSceneRetryTargetsFromReport,
  pipelineErrorDetails,
  pipelineErrorMessage,
  resolveReportInPath,
  resolveReportOutPath,
  runSceneBranch,
  writeReportToPath,
} from "./run-embeds"

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

describe("resolveReportInPath", () => {
  it("returns undefined when unset or empty", () => {
    expect(resolveReportInPath(undefined)).toBeUndefined()
    expect(resolveReportInPath("")).toBeUndefined()
  })

  it("anchors relative paths to process.cwd()", () => {
    expect(resolveReportInPath(".tmp/report.json")).toBe(
      resolve(process.cwd(), ".tmp/report.json"),
    )
  })
})

describe("extractFailedSceneRetryTargetsFromReport", () => {
  it("extracts and dedupes failed scene outcomes in deterministic order", () => {
    const report = {
      reports: {
        scene: {
          outcomes: [
            {
              status: "failed",
              locale: "es",
              target: {
                coreId: "core-b",
                videoEditionId: "edition-b",
                cmsVideoId: 2,
              },
            },
            {
              status: "failed",
              locale: "en",
              target: {
                coreId: "core-a",
                videoEditionId: "edition-a",
                cmsVideoId: 1,
              },
            },
            {
              status: "failed",
              locale: "en",
              target: {
                coreId: "core-a",
                videoEditionId: "edition-a",
                cmsVideoId: 1,
              },
            },
            {
              status: "skipped",
              locale: "fr",
              target: {
                coreId: "core-c",
                videoEditionId: "edition-c",
                cmsVideoId: 3,
              },
            },
          ],
        },
      },
    }

    expect(extractFailedSceneRetryTargetsFromReport(report)).toEqual([
      {
        coreId: "core-a",
        videoEditionId: "edition-a",
        locale: "en",
        cmsVideoId: 1,
      },
      {
        coreId: "core-b",
        videoEditionId: "edition-b",
        locale: "es",
        cmsVideoId: 2,
      },
    ])
  })

  it("throws a config error when the report is missing scene outcomes", () => {
    expect(() =>
      extractFailedSceneRetryTargetsFromReport({ reports: { scene: {} } }),
    ).toThrow(RunEmbedsConfigError)
  })

  it("throws a config error instead of skipping malformed failed scene outcomes", () => {
    expect(() =>
      extractFailedSceneRetryTargetsFromReport({
        reports: {
          scene: {
            outcomes: [
              {
                status: "failed",
                locale: "en",
                target: {
                  coreId: "core-a",
                  cmsVideoId: 1,
                },
              },
            ],
          },
        },
      }),
    ).toThrow(/reports\.scene\.outcomes\[0\].*videoEditionId/)
  })

  it("returns an empty retry set when there are no failed outcomes", () => {
    expect(
      extractFailedSceneRetryTargetsFromReport({
        reports: { scene: { outcomes: [{ status: "succeeded" }] } },
      }),
    ).toEqual([])
  })
})

describe("pipelineErrorDetails", () => {
  it("preserves scene retry selection details from stale retry errors", () => {
    const retrySelection = {
      requested: 2,
      matched: 1,
      unmatched: 1,
      unmatchedRetryTargets: [
        { coreId: "core-a", videoEditionId: "stale-edition", locale: "en" },
      ],
    }
    const error = Object.assign(new Error("Scene retry selector mismatch"), {
      retrySelection,
    })

    expect(pipelineErrorMessage(error)).toBe("Scene retry selector mismatch")
    expect(pipelineErrorDetails(error)).toEqual({ retrySelection })
  })

  it("ignores malformed retry selection details", () => {
    expect(
      pipelineErrorDetails({
        retrySelection: {
          requested: 1,
          matched: 0,
          unmatched: 1,
          unmatchedRetryTargets: [{ coreId: "core-a" }],
        },
      }),
    ).toBeUndefined()
  })
})

describe("runSceneBranch", () => {
  it("runs preflight with the retry sample asset before invoking the scene workflow", async () => {
    const writes: string[] = []
    const preflight = vi.fn(async () => ({
      ok: true,
      checks: [
        { name: "manager_artifact_storage", status: "passed", reason: "ok" },
      ],
    }))
    const runScene = vi.fn(async () => ({
      totalTargets: 1,
      succeeded: 1,
      skipped: 0,
      failed: 0,
      retrySelection: null,
      groupedFailures: [],
    }))

    const result = await runSceneBranch({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: [],
      locales: [],
      sceneRetryTargets: [
        {
          coreId: "core-a",
          videoEditionId: "edition-a",
          locale: "en",
          cmsVideoId: 123,
        },
      ],
      runManagerArtifactsPreflight: preflight,
      runSceneEmbeddingBackfill: runScene,
      writeStdout: (line) => writes.push(line),
    })

    expect(result.ok).toBe(true)
    expect(preflight).toHaveBeenCalledWith({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      sampleSceneAssetId: 123,
    })
    expect(runScene).toHaveBeenCalledWith({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: undefined,
      locales: undefined,
      retryTargets: [
        {
          coreId: "core-a",
          videoEditionId: "edition-a",
          locale: "en",
          cmsVideoId: 123,
        },
      ],
    })
    expect(writes.map((line) => JSON.parse(line).event)).toEqual([
      "run-embeds.scene.preflight",
      "run-embeds.scene.start",
      "run-embeds.scene.complete",
    ])
  })

  it("does not invoke the scene workflow when preflight fails", async () => {
    const writes: string[] = []
    const runScene = vi.fn()

    const result = await runSceneBranch({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: ["core-a"],
      locales: ["en"],
      sceneRetryTargets: undefined,
      runManagerArtifactsPreflight: vi.fn(async () => ({
        ok: false,
        checks: [
          {
            name: "manager_artifact_storage",
            status: "failed",
            reason: "dns_failed",
          },
        ],
      })),
      runSceneEmbeddingBackfill: runScene,
      writeStdout: (line) => writes.push(line),
    })

    expect(result).toEqual({
      ok: false,
      error: "scene preflight failed: manager_artifact_storage:dns_failed",
    })
    expect(runScene).not.toHaveBeenCalled()
    expect(writes.map((line) => JSON.parse(line).event)).toEqual([
      "run-embeds.scene.preflight",
      "run-embeds.scene.error",
    ])
  })

  it("preserves stale retry selection details from workflow errors", async () => {
    const retrySelection = {
      requested: 1,
      matched: 0,
      unmatched: 1,
      unmatchedRetryTargets: [
        { coreId: "core-a", videoEditionId: "stale-edition", locale: "en" },
      ],
    }

    const result = await runSceneBranch({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: [],
      locales: [],
      sceneRetryTargets: undefined,
      runManagerArtifactsPreflight: vi.fn(async () => ({
        ok: true,
        checks: [],
      })),
      runSceneEmbeddingBackfill: vi.fn(async () => {
        throw Object.assign(new Error("Scene retry selector mismatch"), {
          retrySelection,
        })
      }),
      writeStdout: () => undefined,
    })

    expect(result).toEqual({
      ok: false,
      error: "Scene retry selector mismatch",
      details: { retrySelection },
    })
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
