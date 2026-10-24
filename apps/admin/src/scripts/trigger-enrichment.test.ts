// CLI argv-parsing + report-projection tests for trigger-enrichment.
// Network path is exercised in the local smoke matrix; here we
// cover argv shapes + report parsing without hitting fetch.

import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  CliConfigError,
  extractMissingArtifactsFromReport,
  parseArgvToConfig,
  resolveReportInPath,
} from "./trigger-enrichment"

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "trigger-enrichment-test-"))
})

afterEach(() => {
  // Tests don't accumulate enough data to need explicit cleanup; the
  // OS will reap /tmp/trigger-enrichment-test-* on next reboot.
})

describe("extractMissingArtifactsFromReport", () => {
  function makeReport(opts?: {
    sceneMissing?: Array<{ assetId: number; coreId: string; kind: string }>
    transcriptMissing?: Array<{
      assetId: number
      coreId: string
      kind: string
    }>
  }) {
    return {
      event: "run-embeds.complete",
      pipeline: "both",
      reports: {
        scene: {
          totalTargets: 1,
          succeeded: 0,
          skipped: 1,
          failed: 0,
          missingArtifacts: opts?.sceneMissing ?? [],
        },
        transcript: {
          totalTargets: 1,
          succeeded: 0,
          skipped: 1,
          failed: 0,
          missingArtifacts: opts?.transcriptMissing ?? [],
        },
      },
    }
  }

  it("filters by --kind=scene-analysis (PR1's literal is 'scene-analysis')", () => {
    const report = makeReport({
      sceneMissing: [
        { assetId: 1, coreId: "c-1", kind: "scene-analysis" },
        { assetId: 2, coreId: "c-2", kind: "scene-analysis" },
      ],
      transcriptMissing: [{ assetId: 99, coreId: "c-99", kind: "transcript" }],
    })
    const items = extractMissingArtifactsFromReport(report, "scene-analysis")
    expect(items).toEqual([
      { assetId: 1, coreId: "c-1" },
      { assetId: 2, coreId: "c-2" },
    ])
  })

  it("filters by --kind=transcript", () => {
    const report = makeReport({
      sceneMissing: [{ assetId: 1, coreId: "c-1", kind: "scene-analysis" }],
      transcriptMissing: [{ assetId: 99, coreId: "c-99", kind: "transcript" }],
    })
    expect(extractMissingArtifactsFromReport(report, "transcript")).toEqual([
      { assetId: 99, coreId: "c-99" },
    ])
  })

  it("dedupes by assetId across scene + transcript halves", () => {
    const report = makeReport({
      sceneMissing: [
        { assetId: 5, coreId: "c-5", kind: "scene-analysis" },
        { assetId: 5, coreId: "c-5-dup", kind: "scene-analysis" },
      ],
    })
    expect(extractMissingArtifactsFromReport(report, "scene-analysis")).toEqual(
      [{ assetId: 5, coreId: "c-5" }],
    )
  })

  it("returns ascending-sorted items", () => {
    const report = makeReport({
      sceneMissing: [
        { assetId: 30, coreId: "c-30", kind: "scene-analysis" },
        { assetId: 10, coreId: "c-10", kind: "scene-analysis" },
        { assetId: 20, coreId: "c-20", kind: "scene-analysis" },
      ],
    })
    expect(
      extractMissingArtifactsFromReport(report, "scene-analysis").map(
        (i) => i.assetId,
      ),
    ).toEqual([10, 20, 30])
  })

  it("returns [] for malformed report shapes", () => {
    expect(extractMissingArtifactsFromReport(null, "transcript")).toEqual([])
    expect(extractMissingArtifactsFromReport({}, "transcript")).toEqual([])
    expect(
      extractMissingArtifactsFromReport(
        { reports: { scene: { missingArtifacts: "not an array" } } },
        "scene-analysis",
      ),
    ).toEqual([])
  })

  it("ignores entries with wrong kind in the matched half", () => {
    // Defensive: if PR1 ever stamps mixed kinds in one half, we
    // still filter strictly.
    const report = {
      reports: {
        scene: {
          missingArtifacts: [
            { assetId: 1, coreId: "c-1", kind: "transcript" },
            { assetId: 2, coreId: "c-2", kind: "scene-analysis" },
          ],
          // Mixed shapes are purely defensive; active transcript reports
          // emit kind: "transcript".
        },
      },
    }
    expect(extractMissingArtifactsFromReport(report, "scene-analysis")).toEqual(
      [{ assetId: 2, coreId: "c-2" }],
    )
  })
})

describe("resolveReportInPath", () => {
  it("returns undefined for empty/undefined input", () => {
    expect(resolveReportInPath(undefined)).toBeUndefined()
    expect(resolveReportInPath("")).toBeUndefined()
  })

  it("returns absolute paths verbatim", () => {
    expect(resolveReportInPath("/abs/path.json")).toBe("/abs/path.json")
  })

  it("resolves relative paths against process.cwd()", () => {
    const out = resolveReportInPath("foo.json")
    expect(out).toBe(join(process.cwd(), "foo.json"))
  })
})

describe("parseArgvToConfig", () => {
  const env = {
    ADMIN_GRAPHQL_URL: "http://localhost:3003/api/graphql",
    WORKFLOW_API_KEY: "wf-key",
  }

  it("rejects missing --kind", async () => {
    await expect(parseArgvToConfig([], env)).rejects.toBeInstanceOf(
      CliConfigError,
    )
  })

  it("rejects bogus --kind value", async () => {
    await expect(parseArgvToConfig(["--kind=bogus"], env)).rejects.toThrowError(
      /expected scene-analysis\|transcript/,
    )
  })

  it("rejects mutual --from-report + --asset-id", async () => {
    await expect(
      parseArgvToConfig(
        [
          "--kind=scene-analysis",
          "--from-report=/tmp/x.json",
          "--asset-id=1",
          "--core-id=c-1",
        ],
        env,
      ),
    ).rejects.toThrowError(/mutually exclusive/)
  })

  it("rejects mismatched --asset-id / --core-id pairs", async () => {
    await expect(
      parseArgvToConfig(
        [
          "--kind=scene-analysis",
          "--asset-id=1",
          "--asset-id=2",
          "--core-id=c-1",
        ],
        env,
      ),
    ).rejects.toThrowError(/matched pairs/)
  })

  it("rejects non-positive asset-id", async () => {
    await expect(
      parseArgvToConfig(
        ["--kind=scene-analysis", "--asset-id=0", "--core-id=c-0"],
        env,
      ),
    ).rejects.toThrowError(/positive integers/)
  })

  it("requires either --from-report or paired flags", async () => {
    await expect(
      parseArgvToConfig(["--kind=scene-analysis"], env),
    ).rejects.toThrowError(/--from-report.*--asset-id/)
  })

  it("falls back to env for ADMIN_GRAPHQL_URL / WORKFLOW_API_KEY", async () => {
    const config = await parseArgvToConfig(
      ["--kind=transcript", "--asset-id=1", "--core-id=c-1"],
      env,
    )
    expect(config.graphqlUrl).toBe(env.ADMIN_GRAPHQL_URL)
    expect(config.bearer).toBe(env.WORKFLOW_API_KEY)
  })

  it("argv flags override env", async () => {
    const config = await parseArgvToConfig(
      [
        "--kind=transcript",
        "--asset-id=1",
        "--core-id=c-1",
        "--admin-graphql-url=http://overridden/api/graphql",
        "--workflow-api-key=overridden-key",
      ],
      env,
    )
    expect(config.graphqlUrl).toBe("http://overridden/api/graphql")
    expect(config.bearer).toBe("overridden-key")
  })

  it("rejects when env + argv both lack ADMIN_GRAPHQL_URL", async () => {
    await expect(
      parseArgvToConfig(
        ["--kind=scene-analysis", "--asset-id=1", "--core-id=c-1"],
        { WORKFLOW_API_KEY: "wf" },
      ),
    ).rejects.toThrowError(/ADMIN_GRAPHQL_URL/)
  })

  it("reads --from-report and projects items by kind", async () => {
    const path = join(tmpDir, "report.json")
    await writeFile(
      path,
      JSON.stringify({
        reports: {
          transcript: {
            missingArtifacts: [
              { assetId: 50, coreId: "c-50", kind: "transcript" },
              { assetId: 51, coreId: "c-51", kind: "transcript" },
            ],
          },
          scene: {
            missingArtifacts: [
              { assetId: 99, coreId: "c-99", kind: "scene-analysis" },
            ],
          },
        },
      }),
    )
    const config = await parseArgvToConfig(
      ["--kind=transcript", `--from-report=${path}`],
      env,
    )
    expect(config.kind).toBe("transcript")
    expect(config.items).toEqual([
      { assetId: 50, coreId: "c-50" },
      { assetId: 51, coreId: "c-51" },
    ])
  })

  it("rejects --from-report when no matching kind entries are present", async () => {
    const path = join(tmpDir, "empty.json")
    await writeFile(
      path,
      JSON.stringify({
        reports: {
          scene: { missingArtifacts: [] },
        },
      }),
    )
    await expect(
      parseArgvToConfig(["--kind=transcript", `--from-report=${path}`], env),
    ).rejects.toThrowError(/no missing artifacts of kind=transcript/)
  })

  it("rejects --from-report on read error", async () => {
    await expect(
      parseArgvToConfig(
        ["--kind=transcript", "--from-report=/nonexistent.json"],
        env,
      ),
    ).rejects.toThrowError(/failed to read --from-report/)
  })

  it("rejects --from-report with malformed JSON", async () => {
    const path = join(tmpDir, "bad.json")
    await writeFile(path, "{ this is not json")
    await expect(
      parseArgvToConfig(["--kind=transcript", `--from-report=${path}`], env),
    ).rejects.toThrowError(/not valid JSON/)
  })
})
