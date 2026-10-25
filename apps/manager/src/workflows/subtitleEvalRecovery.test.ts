import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import {
  buildSourceReferenceDigestVector,
  canonicalDigest,
} from "@/features/subtitle-lab/subtitle-lab-contract"
import {
  buildSubtitleEvalWorkflowInput,
  recoverStaleSubtitleEvalRuns,
  recoverSubtitleEvalRun,
} from "./subtitleEvalRecovery"
import {
  corpusFixture,
  referenceClippedDigest,
  runFixture,
  sourceClippedDigest,
} from "./subtitleEvalTestFixtures"

describe("subtitle evaluation recovery", () => {
  let client: ReturnType<typeof clientFixture>

  beforeEach(() => {
    client = clientFixture()
  })

  it("requeues with the fresh machine fence and preserves frozen identities", async () => {
    const launch = vi.fn(async () => undefined)
    client.recoverMachineRun.mockResolvedValueOnce({
      id: "run-1",
      status: "REQUEUED",
      digest: null,
      replayed: false,
    })

    await recoverSubtitleEvalRun({
      client: client as unknown as SubtitleLabAdminClient,
      runId: "run-1",
      launch,
    })

    expect(client.recoverMachineRun).toHaveBeenCalledWith({
      runId: "run-1",
      leaseGeneration: 2,
      leaseToken: "machine-fence",
      dispatchFailed: false,
    })
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        cells: [
          expect.objectContaining({
            targetLanguageId: "language-es",
            targetLanguageSlug: "spanish",
            source: expect.objectContaining({
              clippedSha256: sourceClippedDigest,
            }),
            reference: expect.objectContaining({
              clippedSha256: referenceClippedDigest,
            }),
          }),
        ],
      }),
    )
  })

  it("writes the terminal report after machine recovery with the exact Admin vector", async () => {
    client.recoverMachineRun.mockResolvedValueOnce({
      id: "run-1",
      status: "READY_TO_FINALIZE",
      digest: null,
      replayed: false,
    })

    await recoverSubtitleEvalRun({
      client: client as unknown as SubtitleLabAdminClient,
      runId: "run-1",
      dispatchFailed: true,
      launch: vi.fn(),
    })

    const corpus = corpusFixture()
    const run = runFixture()
    expect(client.finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        expectedStatus: "COMPLETED",
        expectedCorpusIdentityDigest: corpus.identityDigest,
        expectedSourceReferenceDigest: canonicalDigest(
          buildSourceReferenceDigestVector({
            corpusCells: corpus.cells,
            runCells: run.cells,
          }),
        ),
        reproducibilityLimits: [
          "Development benchmark; no automatic publication or prompt activation.",
          "Provider seed unavailable.",
          "Recovered after a stale or rejected Manager workflow dispatch.",
        ],
      }),
    )
  })

  it("does not replay an already stored terminal report", async () => {
    client.recoverMachineRun.mockResolvedValueOnce({
      id: "run-1",
      status: "READY_TO_FINALIZE",
      digest: null,
      replayed: true,
    })
    client.getRun.mockResolvedValueOnce({
      ...runFixture(),
      terminalReport: { reportDigest: "already-finalized" },
    } as never)

    await recoverSubtitleEvalRun({
      client: client as unknown as SubtitleLabAdminClient,
      runId: "run-1",
      launch: vi.fn(),
    })

    expect(client.finalizeRun).not.toHaveBeenCalled()
  })

  it("isolates a raced or unavailable stale run and continues", async () => {
    client.listStaleRuns.mockResolvedValueOnce({
      nodes: [
        { id: "run-1", status: "RUNNING" },
        { id: "run-2", status: "RUNNING" },
      ],
      nextCursor: null,
    })
    client.claimMachineRecovery
      .mockRejectedValueOnce(new Error("raced"))
      .mockResolvedValueOnce({
        id: "run-2",
        status: "RUNNING",
        digest: "2:machine-fence:2026-08-20T12:00:00.000Z",
        replayed: false,
      })
    client.recoverMachineRun.mockResolvedValueOnce({
      id: "run-2",
      status: "NOOP",
      digest: null,
      replayed: false,
    })

    await expect(
      recoverStaleSubtitleEvalRuns({
        client: client as unknown as SubtitleLabAdminClient,
        launch: vi.fn(),
      }),
    ).resolves.toEqual([
      { runId: "run-1", status: "SKIPPED_OR_RACED" },
      { runId: "run-2", status: "NOOP" },
    ])
  })

  it("rejects a run/corpus identity mismatch before dispatch", () => {
    expect(() =>
      buildSubtitleEvalWorkflowInput(
        { ...runFixture(), corpusVersionId: "other-corpus" } as never,
        corpusFixture(),
      ),
    ).toThrow(/corpus mismatch/i)
  })
})

function clientFixture() {
  return {
    claimMachineRecovery: vi.fn(async () => ({
      id: "run-1",
      status: "RUNNING",
      digest: "2:machine-fence:2026-08-20T12:00:00.000Z",
      replayed: false,
    })),
    recoverMachineRun: vi.fn(),
    getRun: vi.fn(async () => runFixture()),
    getCorpusVersion: vi.fn(async () => corpusFixture()),
    finalizeRun: vi.fn(async () => ({
      id: "run-1",
      status: "COMPLETED",
      digest: "7".repeat(64),
      replayed: false,
    })),
    listStaleRuns: vi.fn(),
  }
}
