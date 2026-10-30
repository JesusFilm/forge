import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../config/env", () => ({ env: { DD_VERSION: "a".repeat(40) } }))
vi.mock("../services/recommendations/legacy-quality-holds", () => ({
  assertOriginalQualityHolds: vi.fn(),
}))

import {
  executeRetirementWave,
  freezeRetirementWave,
  parseWaveArguments,
  validateWaveInput,
} from "./retire-legacy-recommendation-detail-wave"

const sha = (value: unknown) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex")
const sourceFiles = [
  "src/scripts/retire-legacy-recommendation-campaign.ts",
  "src/services/recommendations/legacy-detail-retirement-campaign.ts",
  "src/scripts/retire-legacy-recommendation-detail.ts",
  "src/services/recommendations/legacy-detail-retirement.service.ts",
  "src/services/recommendations/legacy-candidate-trace-conversion.service.ts",
  "src/services/recommendations/legacy-quality-holds.ts",
]
const target = "b".repeat(64)
const revision = "a".repeat(40)
const sourceHashes = Object.fromEntries(
  sourceFiles.map((file) => [file, sha(readFileSync(file))]),
)
const entrypointSha256 = sha(
  readFileSync("src/scripts/retire-legacy-recommendation-detail-wave.ts"),
)
const future = (milliseconds: number) =>
  new Date(Date.now() + milliseconds).toISOString()
const holdSet = {
  qualitySelectorSha256: "c".repeat(64),
  qualityRunIds: Array.from(
    { length: 64 },
    (_, index) => `synthetic-quality-${index}`,
  ),
  activeInvestigationRunIds: [],
}
function fixture() {
  const expiresAt = future(3_600_000)
  const baseline = {
    id: "synthetic-run-a",
    stage_count: 18,
    declared_stage_count: 18,
    trace_format_version: null,
    legacy_detail_retired_at: null,
    expires_at: expiresAt,
    root_expires_at: expiresAt,
  }
  const wave = {
    index: 0,
    plannedEnd: future(600_000),
    batches: [
      [
        {
          runId: baseline.id,
          declaredStageRows: 18,
          expiresAt,
          stageRows: 18,
          baseline,
          baselineSha256: sha(baseline),
        },
      ],
    ],
  }
  const input = {
    masterDigest: "d".repeat(64),
    masterHeader: {
      digest: "d".repeat(64),
      targetDatabaseHash: target,
      createdBefore: future(-86_400_000),
      originalRevision: revision,
      sourceHashes,
      selectionReceiptSha256: "e".repeat(64),
    },
    waveIndex: 0,
    waveDigest: sha(wave),
    wave,
    expectedRevision: revision,
    sourceHashes,
    entrypointSha256,
    holdsEnvelope: {
      reviewedAt: future(-1000),
      sourceReceiptSha256: "f".repeat(64),
      holds: holdSet,
    },
    capacity: {
      measuredAt: future(-1000),
      targetDatabaseHash: target,
      filesystemAvailableBytes: 10_000_000_000,
      walBytes: 100_000_000,
      httpHealthy: true as const,
      workerHealthy: true as const,
      compactWritersConverged: true as const,
      retentionHealthy: true as const,
    },
  }
  return validateWaveInput(input)
}
function manifest(input: ReturnType<typeof fixture>) {
  const body = {
    version: 2 as const,
    targetDatabaseHash: target,
    createdBefore: input.masterHeader.createdBefore,
    frozenAt: future(-1000),
    holds: holdSet,
    candidates: [
      {
        runId: "synthetic-run-a",
        action: "preserve" as const,
        fingerprint: "f".repeat(32),
        rows: 18,
        bytes: 100,
      },
    ],
  }
  return { ...body, digest: sha(body) }
}
function backed(
  input: ReturnType<typeof fixture>,
  item: ReturnType<typeof manifest>,
) {
  const manifestSetSha256 = sha([{ index: 0, digest: item.digest }])
  const archiveReceipt = {
    waveDigest: input.waveDigest,
    manifestSetSha256,
    count: 1,
    fileSha256: [{ index: 0, sha256: sha(Buffer.from(JSON.stringify(item))) }],
  }
  return {
    ...input,
    manifests: [item],
    ack: {
      kind: "durable-private-ack" as const,
      waveDigest: input.waveDigest,
      manifestSetSha256,
      archivedAt: future(-1000),
      archiveReceipt,
      archiveReceiptSha256: sha(archiveReceipt),
    },
  }
}

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

describe("finite wave batch CLI", () => {
  it("retains the operator wire order used by the admitted wave digest", () => {
    const input = fixture()
    expect(sha(input.wave)).toBe(input.waveDigest)
    expect(Object.keys(input.wave.batches[0]![0]!)).toEqual([
      "runId",
      "declaredStageRows",
      "expiresAt",
      "stageRows",
      "baseline",
      "baselineSha256",
    ])
  })

  it("requires a single phase and explicit target confirmation", () => {
    expect(
      parseWaveArguments([
        "--freeze-wave",
        "--input",
        "x",
        "--manifest-dir",
        "y",
      ]).phase,
    ).toBe("--freeze-wave")
    expect(() =>
      parseWaveArguments(["--execute-wave", "--input", "x"]),
    ).toThrow()
    expect(() =>
      parseWaveArguments(["--freeze-wave", "--execute-wave", "--input", "x"]),
    ).toThrow()
  })

  it("freezes a v2 manifest into a private file without execution or acknowledgement", async () => {
    const input = fixture()
    const item = manifest(input)
    const directory = mkdtempSync(join(tmpdir(), "forge-wave-freeze-"))
    directories.push(directory)
    const freeze = vi.fn().mockResolvedValue(item)
    const run = vi.fn()
    const receipts: object[] = []
    await freezeRetirementWave(
      {} as never,
      input,
      directory,
      () => input,
      { freeze, run, target: vi.fn().mockResolvedValue(target) } as never,
      (receipt) => receipts.push(receipt),
    )
    expect(freeze).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
    expect(readdirSync(directory)).toEqual(["manifest-00.json"])
    expect(
      JSON.parse(readFileSync(join(directory, "manifest-00.json"), "utf8"))
        .digest,
    ).toBe(item.digest)
    expect(receipts.at(-1)).toMatchObject({
      status: "frozen-awaiting-local-ack",
      databaseWrites: 0,
    })
  })

  it("requires a durable full-set ACK, dry-runs first, then executes exactly once", async () => {
    const input = fixture()
    const item = manifest(input)
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        status: "dry-run",
        converted: 0,
        retired: 0,
        rows: 18,
        bytes: 100,
      })
      .mockResolvedValueOnce({
        status: "completed",
        converted: 1,
        retired: 0,
        rows: 18,
        bytes: 100,
      })
    const api = {
      freeze: vi.fn(),
      run,
      target: vi.fn().mockResolvedValue(target),
    } as never
    await expect(
      executeRetirementWave(
        {} as never,
        { ...input, manifests: [item] },
        () => input,
        api,
      ),
    ).rejects.toThrow("Durable private archive")
    expect(run).not.toHaveBeenCalled()
    const approved = backed(input, item)
    const receipts: object[] = []
    await executeRetirementWave(
      {} as never,
      approved,
      () => approved,
      api,
      (receipt) => receipts.push(receipt),
    )
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[0]?.[2]).toEqual({ execute: false })
    expect(run.mock.calls[1]?.[2]).toEqual({
      execute: true,
      confirmTarget: target,
    })
    expect(receipts.at(-1)).toMatchObject({
      status: "wave-cli-completed-requires-readonly-reconcile",
      completedBatches: 1,
    })
  })

  it("stops before mutation on changed holds, stale capacity or expiry", async () => {
    const input = fixture()
    const item = manifest(input)
    const approved = backed(input, item)
    const run = vi.fn()
    const api = {
      freeze: vi.fn(),
      run,
      target: vi.fn().mockResolvedValue(target),
    } as never
    await expect(
      executeRetirementWave(
        {} as never,
        approved,
        () => ({
          ...approved,
          holdsEnvelope: {
            ...approved.holdsEnvelope,
            holds: {
              ...approved.holdsEnvelope.holds,
              activeInvestigationRunIds: ["changed"],
            },
          },
        }),
        api,
      ),
    ).rejects.toThrow("Current protection")
    await expect(
      executeRetirementWave(
        {} as never,
        approved,
        () => ({
          ...approved,
          capacity: { ...approved.capacity, measuredAt: future(-180_000) },
        }),
        api,
      ),
    ).rejects.toThrow("Current fleet")
    expect(() =>
      validateWaveInput({
        ...input,
        wave: { ...input.wave, plannedEnd: future(-1000) },
      }),
    ).toThrow()
    expect(run).not.toHaveBeenCalled()
  })
})
