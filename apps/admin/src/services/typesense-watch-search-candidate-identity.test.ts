import { readFileSync } from "node:fs"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  candidateWatchSearchApplicationRevision,
  candidateWatchSearchRankingRevision,
} from "./typesense-watch-search-candidate-identity"

describe("candidateWatchSearchApplicationRevision", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("does not change when an unrelated deployment commit changes", () => {
    vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", "deployment-a")
    const firstRevision = candidateWatchSearchApplicationRevision()

    vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", "deployment-b")

    expect(candidateWatchSearchApplicationRevision()).toBe(firstRevision)
    expect(firstRevision).toBe("watch-search-candidate/v2")
  })

  it("tracks ranking qualification separately from collection compatibility", () => {
    expect(candidateWatchSearchRankingRevision()).toBe("title-and-brand-v1")
  })

  it("is the only revision source used by every candidate boundary", () => {
    const consumers = [
      new URL(
        "../scripts/index-typesense-watch-search-candidate.ts",
        import.meta.url,
      ),
      new URL(
        "../scripts/benchmark-watch-search-candidate.ts",
        import.meta.url,
      ),
      new URL(
        "./typesense-watch-search-comparison.service.ts",
        import.meta.url,
      ),
      new URL("./index.ts", import.meta.url),
    ]

    for (const consumer of consumers) {
      const source = readFileSync(consumer, "utf8")
      expect(source).toContain("candidateWatchSearchApplicationRevision()")
      expect(source).not.toMatch(
        /NEXT_PUBLIC_DATADOG_VERSION|RAILWAY_GIT_COMMIT_SHA|VERCEL_GIT_COMMIT_SHA|GIT_COMMIT_SHA/,
      )
    }
  })

  it("binds ranking qualification and serving to the shared ranking revision", () => {
    const consumers = [
      new URL(
        "../scripts/benchmark-watch-search-candidate.ts",
        import.meta.url,
      ),
      new URL("./index.ts", import.meta.url),
    ]

    for (const consumer of consumers) {
      expect(readFileSync(consumer, "utf8")).toContain(
        "candidateWatchSearchRankingRevision()",
      )
    }
  })
})
