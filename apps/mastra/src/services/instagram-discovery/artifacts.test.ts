import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  InstagramDiscoveryArtifactError,
  createInstagramDiscoveryArtifactStore,
} from "./artifacts"
import type { DiscoveryReport } from "./types"

function sampleReport(
  overrides: Partial<DiscoveryReport> = {},
): DiscoveryReport {
  return {
    schemaVersion: "1",
    kind: "instagram-ai-christian-discovery",
    reportId: "run-123",
    mastraRunId: "run-123",
    startedAt: "2026-06-08T00:00:00.000Z",
    finishedAt: "2026-06-08T00:00:05.000Z",
    queries: ["AI generated Jesus reel site:instagram.com"],
    totals: {
      candidates: 3,
      instagram: 2,
      deduped: 2,
      excludedCommentary: 0,
      qualified: 1,
    },
    queryFailures: [],
    posts: [
      {
        url: "https://www.instagram.com/reel/ABC123/",
        shortcode: "ABC123",
        mediaType: "reel",
        authorHandle: "grace.films",
        authorName: "Grace Films",
        caption: "AI generated Jesus reel",
        hashtags: ["#aiart", "#faith"],
        publishedAt: null,
        thumbnailUrl: null,
        matchedAi: ["ai generated"],
        matchedChristian: ["jesus"],
      },
    ],
    ...overrides,
  }
}

describe("instagram discovery artifact store", () => {
  let rootDir: string

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "ig-discovery-"))
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  it("round-trips a report through write then read", async () => {
    const store = createInstagramDiscoveryArtifactStore(rootDir)
    const report = sampleReport()

    const { path: written } = await store.writeReport(report)
    expect(written).toContain("run-123.json")

    const read = await store.readReport("run-123")
    expect(read).toEqual(report)
  })

  it("rejects unsafe report names", async () => {
    const store = createInstagramDiscoveryArtifactStore(rootDir)
    await expect(store.readReport("../escape")).rejects.toMatchObject({
      code: "invalid_name",
    })
  })

  it("returns not_found for a missing report", async () => {
    const store = createInstagramDiscoveryArtifactStore(rootDir)
    await expect(store.readReport("missing")).rejects.toMatchObject({
      code: "not_found",
    })
  })

  it("returns invalid_artifact for malformed JSON on disk", async () => {
    const store = createInstagramDiscoveryArtifactStore(rootDir)
    await mkdir(path.join(rootDir, "reports"), { recursive: true })
    await writeFile(
      path.join(rootDir, "reports", "bad.json"),
      "{ not json",
      "utf8",
    )
    await expect(store.readReport("bad")).rejects.toMatchObject({
      code: "invalid_artifact",
    })
  })

  it("rejects a report that violates schema bounds on write", async () => {
    const store = createInstagramDiscoveryArtifactStore(rootDir)
    const tooManyQueries = sampleReport({
      queries: Array.from({ length: 25 }, (_, index) => `q${index}`),
    })
    const error = await store
      .writeReport(tooManyQueries)
      .catch((cause) => cause)
    expect(error).toBeInstanceOf(InstagramDiscoveryArtifactError)
    expect(error.code).toBe("invalid_artifact")
  })

  it("rejects a report whose post field exceeds a length bound", async () => {
    const store = createInstagramDiscoveryArtifactStore(rootDir)
    const report = sampleReport()
    report.posts[0]!.thumbnailUrl = `https://img.example/${"a".repeat(600)}.jpg`
    const error = await store.writeReport(report).catch((cause) => cause)
    expect(error).toBeInstanceOf(InstagramDiscoveryArtifactError)
    expect(error.code).toBe("invalid_artifact")
  })

  it("persists every possible per-source failure for a full run", async () => {
    const store = createInstagramDiscoveryArtifactStore(rootDir)
    const report = sampleReport({
      queryFailures: Array.from({ length: 70 }, (_, index) => ({
        query: `source-${index}`,
        code: "upstream_failed" as const,
        message: "timed out",
      })),
      posts: [],
    })

    await expect(store.writeReport(report)).resolves.toEqual({
      path: expect.stringContaining("run-123.json"),
    })
  })
})
