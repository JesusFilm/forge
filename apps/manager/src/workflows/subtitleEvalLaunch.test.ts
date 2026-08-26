import { describe, expect, it, vi } from "vitest"

import type { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import type { ManagerSessionPrincipal } from "@/lib/manager-session-cookie"
import {
  createAndLaunchSubtitleEvalRun,
  loadSubtitleEvalCodeRevision,
} from "./subtitleEvalLaunch"
import { corpusFixture, runFixture } from "./subtitleEvalTestFixtures"

const session = {
  id: "operator-1",
  subject: "subject-1",
  email: "operator@example.com",
  managerRole: "OPERATOR",
  scopes: [],
  reviewerLanguageGrants: [],
} satisfies ManagerSessionPrincipal

describe("subtitle evaluation launch", () => {
  it("does not redispatch an idempotent replay", async () => {
    const launch = vi.fn()
    const client = clientFixture()
    client.createRun.mockResolvedValueOnce({
      id: "run-1",
      status: "QUEUED",
      digest: "1".repeat(64),
      replayed: true,
    })

    await expect(
      createAndLaunchSubtitleEvalRun({
        rawRequest: launchRequest(),
        session,
        client: client as unknown as SubtitleLabAdminClient,
        launch,
        deployedCodeRevision: "deployed-revision",
      }),
    ).resolves.toEqual({ runId: "run-1", status: "QUEUED", replayed: true })
    expect(client.getRun).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
  })

  it("recovers under a machine fence when initial dispatch fails", async () => {
    const client = clientFixture()
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new Error("workflow unavailable"))
      .mockResolvedValueOnce(undefined)

    await expect(
      createAndLaunchSubtitleEvalRun({
        rawRequest: launchRequest(),
        session,
        client: client as unknown as SubtitleLabAdminClient,
        launch,
        deployedCodeRevision: "deployed-revision",
      }),
    ).resolves.toMatchObject({ replayed: false })
    expect(client.recoverMachineRun).toHaveBeenCalledWith(
      expect.objectContaining({ dispatchFailed: true }),
    )
    expect(launch).toHaveBeenCalledTimes(2)
  })

  it("rejects duplicate or out-of-corpus selections before creating a run", async () => {
    const client = clientFixture()
    await expect(
      createAndLaunchSubtitleEvalRun({
        rawRequest: {
          ...launchRequest(),
          corpusCellIds: ["corpus-cell-1", "corpus-cell-1"],
        },
        session,
        client: client as unknown as SubtitleLabAdminClient,
        launch: vi.fn(),
        deployedCodeRevision: "deployed-revision",
      }),
    ).rejects.toThrow(/selection/i)
    expect(client.createRun).not.toHaveBeenCalled()
  })

  it("rejects a browser-spoofed revision", async () => {
    const client = clientFixture()
    await expect(
      createAndLaunchSubtitleEvalRun({
        rawRequest: { ...launchRequest(), codeRevision: "browser-revision" },
        session,
        client: client as unknown as SubtitleLabAdminClient,
        launch: vi.fn(),
        deployedCodeRevision: "deployed-revision",
      }),
    ).rejects.toThrow(/deployed build/i)
    expect(client.createRun).not.toHaveBeenCalled()
  })

  it("injects the deployed revision when the browser omits it", async () => {
    const client = clientFixture()
    await createAndLaunchSubtitleEvalRun({
      rawRequest: launchRequest(),
      session,
      client: client as unknown as SubtitleLabAdminClient,
      launch: vi.fn(async () => undefined),
      deployedCodeRevision: "deployed-revision",
    })

    expect(client.createRun).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ codeRevision: "deployed-revision" }),
    )
  })

  it.each([undefined, "unknown", "   "])(
    "fails closed in production when deployed revision is %s",
    (revision) => {
      expect(() =>
        loadSubtitleEvalCodeRevision({
          nodeEnv: "production",
          railwayRevision: revision,
        }),
      ).toThrow(/deployed source code revision/i)
    },
  )
})

function clientFixture() {
  return {
    getCorpusVersion: vi.fn(async () => corpusFixture()),
    createRun: vi.fn(async () => ({
      id: "run-1",
      status: "QUEUED",
      digest: "1".repeat(64),
      replayed: false,
    })),
    getRun: vi.fn(async () => ({ ...runFixture(), status: "QUEUED" })),
    claimMachineRecovery: vi.fn(async () => ({
      id: "run-1",
      status: "RUNNING",
      digest: "1:machine-fence:2026-08-20T12:00:00.000Z",
      replayed: false,
    })),
    recoverMachineRun: vi.fn(async () => ({
      id: "run-1",
      status: "REQUEUED",
      digest: null,
      replayed: false,
    })),
  }
}

function launchRequest() {
  return {
    idempotencyKey: "launch-1",
    corpusVersionId: "corpus-1",
    corpusCellIds: ["corpus-cell-1"],
    requestedProvider: "openrouter",
    requestedModel: "google/gemini-2.5-flash",
    promptPolicyId: "subtitle-enrichment-production-v1",
    workflowPolicyDigest:
      "52e1ed3fea0be2fb9165c2bb6f4fc1fb58f107f6fe1692dd828ffb95e3e7a601",
    determinism: { temperature: 0, providerSeed: null },
    concurrency: 1,
    timeoutSeconds: 60,
    maxAttempts: 2,
  }
}
