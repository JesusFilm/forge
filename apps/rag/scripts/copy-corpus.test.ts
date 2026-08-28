import { describe, expect, it } from "vitest"

import {
  MigrationUsageError,
  parseCorpusCopyArgs,
  retrievalEquivalent,
  serializeReport,
} from "./copy-corpus.js"

describe("corpus copy CLI contract", () => {
  it("defaults to a read-only dry run and environment-variable credentials", () => {
    expect(parseCorpusCopyArgs([])).toMatchObject({
      dryRun: true,
      verifyOnly: false,
      resume: false,
      sourceEnv: "JFRAG_SOURCE_DATABASE_URL",
      targetEnv: "DATABASE_URL",
      batchSize: 250,
    })
  })

  it("accepts identical rankings within the recorded score tolerance", () => {
    const source = [
      { probeId: "probe", hits: [{ chunk_id: "hit", score: 0.75 }] },
    ]
    expect(
      retrievalEquivalent(source, [
        { probeId: "probe", hits: [{ chunk_id: "hit", score: 0.750009 }] },
      ]),
    ).toBe(true)
    expect(
      retrievalEquivalent(source, [
        { probeId: "probe", hits: [{ chunk_id: "other", score: 0.75 }] },
      ]),
    ).toBe(false)
    expect(
      retrievalEquivalent(source, [
        { probeId: "probe", hits: [{ chunk_id: "hit", score: 0.75002 }] },
      ]),
    ).toBe(false)
  })

  it("does not claim retrieval equivalence when no probes ran", () => {
    expect(retrievalEquivalent([], [])).toBe(false)
  })

  it("allows read-only post-copy verification without a copy acknowledgement", () => {
    expect(parseCorpusCopyArgs(["--verify-only"])).toMatchObject({
      dryRun: false,
      verifyOnly: true,
    })
  })

  it("requires an explicit copy acknowledgement and rejects URL arguments", () => {
    expect(
      parseCorpusCopyArgs(["--copy", "--confirm-local-copy"]),
    ).toMatchObject({ dryRun: false })
    expect(() => parseCorpusCopyArgs(["--copy"])).toThrow(
      /--confirm-local-copy/,
    )
    expect(() =>
      parseCorpusCopyArgs(["--source-url", "postgresql://secret@host/db"]),
    ).toThrow(MigrationUsageError)
  })

  it("serializes reports without connection strings or corpus text", () => {
    const output = serializeReport({
      schemaVersion: 1,
      status: "equivalent",
      source: { database: "jfrag", hostHash: "abc" },
      target: { database: "forge_rag", hostHash: "def" },
      copiedRows: { sources: 1 },
      reconciliation: { equivalent: true },
    })

    expect(output).not.toContain("postgresql://")
    expect(output).not.toContain("raw_content")
    expect(JSON.parse(output)).toMatchObject({ status: "equivalent" })
  })
})
