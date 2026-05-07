import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  BaselineNotFoundError,
  BaselineSchemaError,
  detectDrift,
  getQueriesForRun,
  loadBaseline,
  saveBaseline,
} from "./baseline"
import type { Baseline, Fingerprint, SearchResult } from "./types"

const sampleResult: SearchResult = {
  type: "video",
  id: "v_1",
  slug: "easter",
  title: "Easter",
  imageUrl: null,
  snippet: "About Easter",
  startSeconds: 0,
  playbackId: null,
  score: 0.5,
}

const sampleFingerprint: Fingerprint = {
  sceneEmbeddings: { count: 100, maxUpdatedAt: "2026-05-01T00:00:00.000Z" },
  transcriptEmbeddings: {
    count: 200,
    maxUpdatedAt: "2026-05-01T00:00:00.000Z",
  },
  experiences: { count: 10, maxUpdatedAt: "2026-05-01T00:00:00.000Z" },
}

const sampleBaseline: Baseline = {
  schemaVersion: "1",
  name: "default",
  capturedAt: "2026-05-07T00:00:00.000Z",
  gitSha: "abc1234",
  contentFingerprint: sampleFingerprint,
  queries: [
    {
      locale: "en",
      query: "hope",
      source: "synthetic",
      results: [sampleResult],
    },
    { locale: "fr", query: "espoir", source: "synthetic", results: [] },
    { locale: "fr", query: "test reg", source: "regression", results: [] },
  ],
}

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "baseline-test-"))
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe("saveBaseline + loadBaseline (round-trip)", () => {
  it("round-trips a baseline through save + load", async () => {
    const { path: written } = await saveBaseline(sampleBaseline, {
      directory: tmp,
    })
    expect(written).toBe(path.join(tmp, "default.json"))

    const loaded = await loadBaseline("default", { directory: tmp })
    expect(loaded).toEqual(sampleBaseline)
  })

  it("writes via .tmp + rename (atomic)", async () => {
    await saveBaseline(sampleBaseline, { directory: tmp })
    // After rename, only the final file should exist; the .tmp must
    // be gone.
    const finalContent = await readFile(path.join(tmp, "default.json"), "utf8")
    expect(JSON.parse(finalContent).name).toBe("default")

    // The .tmp file should not survive a successful save.
    await expect(
      readFile(path.join(tmp, "default.json.tmp"), "utf8"),
    ).rejects.toThrow()
  })

  it("supports multiple named baselines side-by-side", async () => {
    const a: Baseline = { ...sampleBaseline, name: "a" }
    const b: Baseline = { ...sampleBaseline, name: "b" }
    await saveBaseline(a, { directory: tmp })
    await saveBaseline(b, { directory: tmp })

    const loadedA = await loadBaseline("a", { directory: tmp })
    const loadedB = await loadBaseline("b", { directory: tmp })
    expect(loadedA.name).toBe("a")
    expect(loadedB.name).toBe("b")
  })
})

describe("loadBaseline error cases", () => {
  it("throws BaselineNotFoundError when the file is missing", async () => {
    await expect(
      loadBaseline("missing", { directory: tmp }),
    ).rejects.toBeInstanceOf(BaselineNotFoundError)
  })

  it("throws BaselineSchemaError when JSON parsing fails", async () => {
    await writeFile(path.join(tmp, "broken.json"), "not json {")
    await expect(
      loadBaseline("broken", { directory: tmp }),
    ).rejects.toBeInstanceOf(BaselineSchemaError)
  })

  it("throws BaselineSchemaError when schemaVersion is wrong", async () => {
    const wrong = { ...sampleBaseline, schemaVersion: "2" }
    await writeFile(path.join(tmp, "v2.json"), JSON.stringify(wrong))
    await expect(loadBaseline("v2", { directory: tmp })).rejects.toBeInstanceOf(
      BaselineSchemaError,
    )
  })

  it("rejects an unknown query.source value", async () => {
    const bad = {
      ...sampleBaseline,
      queries: [
        {
          locale: "en",
          query: "hope",
          source: "user-log",
          results: [],
        },
      ],
    }
    await writeFile(path.join(tmp, "bad.json"), JSON.stringify(bad))
    await expect(
      loadBaseline("bad", { directory: tmp }),
    ).rejects.toBeInstanceOf(BaselineSchemaError)
  })
})

describe("getQueriesForRun", () => {
  it("filters by quick locales", () => {
    const out = getQueriesForRun(sampleBaseline, {
      mode: "quick",
      quickLocales: ["en"],
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.locale).toBe("en")
  })

  it("returns every query for full mode", () => {
    const out = getQueriesForRun(sampleBaseline, { mode: "full" })
    expect(out).toEqual(sampleBaseline.queries)
  })

  it("filters by single locale (regardless of source)", () => {
    const out = getQueriesForRun(sampleBaseline, {
      mode: "locale",
      locale: "fr",
    })
    expect(out).toHaveLength(2)
    expect(out.every((q) => q.locale === "fr")).toBe(true)
  })

  it("returns [] when locale filter matches nothing", () => {
    const out = getQueriesForRun(sampleBaseline, {
      mode: "locale",
      locale: "xx",
    })
    expect(out).toEqual([])
  })
})

describe("detectDrift", () => {
  it("reports no drift when fingerprints match", () => {
    expect(detectDrift(sampleBaseline, sampleFingerprint)).toEqual({
      detected: false,
      details: "no drift since baseline",
    })
  })

  it("reports drift when scene count diverges", () => {
    const current: Fingerprint = {
      ...sampleFingerprint,
      sceneEmbeddings: {
        ...sampleFingerprint.sceneEmbeddings,
        count: sampleFingerprint.sceneEmbeddings.count + 256,
      },
    }
    const result = detectDrift(sampleBaseline, current)
    expect(result.detected).toBe(true)
    expect(result.details).toContain("scene+256")
  })
})
