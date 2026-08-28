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

  it("requires production provenance and an exact target identity", () => {
    expect(() =>
      parseCorpusCopyArgs([
        "--copy",
        "--confirm-production-copy",
        "--expected-target-host-hash",
        "0123456789abcdef",
      ]),
    ).toThrow(/source snapshot reference/)

    expect(
      parseCorpusCopyArgs([
        "--copy",
        "--confirm-production-copy",
        "--expected-target-host-hash",
        "0123456789abcdef",
        "--source-snapshot-reference",
        "jfrag-backup-2026-08-28",
        "--source-cutoff",
        "2026-08-28T02:00:00Z",
      ]),
    ).toMatchObject({
      production: true,
      expectedTargetHostHash: "0123456789abcdef",
      sourceSnapshotReference: "jfrag-backup-2026-08-28",
      sourceCutoff: "2026-08-28T02:00:00.000Z",
    })
  })

  it("rejects ambiguous or malformed production acknowledgements", () => {
    expect(() =>
      parseCorpusCopyArgs([
        "--copy",
        "--confirm-local-copy",
        "--confirm-production-copy",
        "--expected-target-host-hash",
        "0123456789abcdef",
        "--source-snapshot-reference",
        "backup",
        "--source-cutoff",
        "not-a-date",
      ]),
    ).toThrow(MigrationUsageError)
  })

  it("serializes reports without connection strings or corpus text", () => {
    const output = serializeReport({
      schemaVersion: 1,
      status: "equivalent",
      source: { database: "jfrag", hostHash: "abc" },
      target: { database: "forge_rag", hostHash: "def" },
      copiedRows: { sources: 1 },
      operation: {
        mode: "production",
        sourceSnapshotReference: "backup-1",
        sourceCutoff: "2026-08-28T02:00:00.000Z",
      },
      reconciliation: { equivalent: true },
    })

    expect(output).not.toContain("postgresql://")
    expect(output).not.toContain("raw_content")
    expect(JSON.parse(output)).toMatchObject({ status: "equivalent" })
  })
})
