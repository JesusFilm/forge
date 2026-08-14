import { beforeEach, describe, expect, it, vi } from "vitest"
import { Mastra } from "@mastra/core"
import { InMemoryStore } from "@mastra/core/storage"
import { LocalFilesystem, Workspace } from "@mastra/core/workspace"

import type { GeneratedDevotional } from "../../services/devotional/generate-devotional"
import {
  devotionalProduceWorkflow,
  devotionalPublishWorkflow,
  qualityBlocksRun,
} from "./video-first-devotional"

/**
 * A run persisted BEFORE the `quality` key existed, resuming across the deploy
 * that added it.
 *
 * This existed as a real bug: produce treated the missing key as renderable while
 * publish treated the same state as quality-blocked, so a legacy run paid for
 * narration and a Remotion render and was then refused at publication. Both
 * callers now ask one function, and these tests hold that shape at the two points
 * a run can actually resume from — before the render, and after approval.
 */

const mocks = vi.hoisted(() => ({
  record: vi.fn(async () => true),
  // Returns a promise because the production code chains `.catch` on it; a bare
  // vi.fn() resolves to undefined and turns a harness gap into a TypeError that
  // looks like a product bug.
  release: vi.fn(async () => true),
  durablePublish: vi.fn(),
  verifySources: vi.fn(),
  verifyArtifacts: vi.fn(async () => undefined),
}))

vi.mock("../../services/devotional/devotional-worker-client", () => ({
  devotionalArtifactProxyPath: () => "/assets/x",
  renderDevotionalOnWorker: vi.fn(),
  verifyDevotionalWorkerArtifacts: mocks.verifyArtifacts,
}))

vi.mock("../../services/devotional/workspace/postgres-used-clips", () => ({
  getPostgresUsedClipsStore: () => ({
    read: async () => ({ version: 1, used: {} }),
    reserve: vi.fn(),
    record: mocks.record,
    release: mocks.release,
  }),
}))

vi.mock("../../services/devotional/workspace/source-verification", () => ({
  verifyWorkflowWorkspaceSources: mocks.verifySources,
}))

vi.mock("../../services/devotional/workspace/publication", () => ({
  devotionalPublicationRequestHash: () => "a".repeat(64),
  publishWithDurableIntent: mocks.durablePublish,
}))

vi.mock("../../services/devotional/workspace/provenance", () => ({
  writeInputsUsed: vi.fn(async () => "/runs/test/inputs-used.json"),
  writeAttemptJsonArtifact: vi.fn(async () => "/runs/test/artifact.json"),
}))

vi.mock("../../services/devotional/workspace/attempt-data", () => ({
  loadDevotionalAttemptAuthoredData: async () => ({
    prompts: {
      prompts: {},
      generation: { hookStyles: ["s"], blockOrders: [[]], partnerDomains: [] },
    },
    safety: { minimumConfidence: 0.6, effectiveMinimumConfidence: 0.6 },
    voices: { profiles: {}, settings: {}, rotation: ["male-d"] },
    music: { moods: {}, defaultLengthMs: 60_000 },
    narration: {},
    brand: { name: "Jesus Film", rightsAssertion: "rights" },
    render: { filters: {}, layouts: {}, nativeLayouts: {} },
    chapters: [],
    passages: [],
    scripture: { verses: {} },
    corpora: { ryleMatthew: [], matthewHenry: [], spurgeon: [] },
  }),
}))

const DEVO: GeneratedDevotional = {
  date: "2026-07-21",
  clip: { index: 19, id: "1_jf6119-0-0", title: "Jesus Calms the Storm" },
  passage: { reference: "Luke 8:22-25", osisRef: "Luke.8.22-Luke.8.25" },
  title: "Peace in the Storm",
  scripture: {
    reference: "Luke 8:24",
    text: "He rebuked the wind.",
    translation: "WEB",
    needsCanonicalSource: true,
  },
  reflection: {
    text: "Christ is with you in the boat.",
    source: "Matthew Henry",
    attribution: "Adapted from Matthew Henry",
    flavor: "commentary",
  },
  reflectionHighlights: [],
  conclusion: "The One who calms the sea is in your boat.",
  question: "What storm?",
  prayer: "Jesus, calm my storm.",
  mood: "peace",
  voice: "male-d",
  sequence: 0,
}

const SAFETY = {
  verdict: "pass" as const,
  scores: { doctrine: 1, tone: 1, sensitivity: 1 },
  reasons: [],
}
const RESERVATION_ID = "49cb0cc4-2fdd-4edb-a1f6-d90664d2c885"
const ASSET = {
  assetId: "devo_run_1",
  artifactType: "devotional-output-portrait-v1" as const,
  ext: "mp4" as const,
}

/** The persisted shape of a pre-deploy run: NO `quality` key at all. */
function legacyContent() {
  return {
    workspaceGeneration: 1,
    attemptId: "legacy-attempt",
    selectedSources: [
      {
        path: "/inputs/prompts/generation.json",
        category: "prompts" as const,
        digest: "b".repeat(64),
        size: 8077,
        modifiedAt: "2026-07-20T00:00:00.000Z",
        title: "generation prompts",
      },
    ],
    devotional: DEVO,
    safety: SAFETY,
    reservationId: RESERVATION_ID,
  }
}

function registerWorkflows() {
  const mastra = new Mastra({
    workflows: { devotionalProduceWorkflow, devotionalPublishWorkflow },
    storage: new InMemoryStore({ id: "devotional-legacy-test" }),
    workspace: new Workspace({
      id: "devotional-legacy-test-workspace",
      name: "Devotional Legacy Test Workspace",
      filesystem: new LocalFilesystem({
        id: "devotional-legacy-test-fs",
        basePath: "/tmp/devotional-legacy-test-workspace",
        contained: true,
      }),
      tools: { enabled: false },
    }),
  })
  return mastra
}

/**
 * Start and wait for a TERMINAL state. `startAsync` resolves with the run id
 * before the steps finish, so asserting on its return passes whether or not the
 * step under test ran — a mistake already made once in this suite's sibling.
 */
async function runToCompletion(
  workflow: ReturnType<Mastra["getWorkflow"]>,
  runId: string,
  inputData: unknown,
) {
  const run = await workflow.createRun({ runId })
  await run.startAsync({ inputData: inputData as never })
  let state = await workflow.getWorkflowRunById(runId)
  for (
    let attempt = 0;
    attempt < 100 &&
    state?.status !== "success" &&
    state?.status !== "failed" &&
    state?.status !== "suspended";
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    state = await workflow.getWorkflowRunById(runId)
  }
  return state
}

describe("qualityBlocksRun", () => {
  // Three states, three answers. Conflating any two of them is the bug this
  // function exists to prevent, so each is pinned separately.
  it("does not block a LEGACY run (key absent)", () => {
    expect(qualityBlocksRun(undefined)).toBe(false)
  })

  it("blocks when quality is null (safety blocked, so it never ran)", () => {
    expect(qualityBlocksRun(null)).toBe(true)
  })

  it("blocks an enforced verdict with findings", () => {
    expect(qualityBlocksRun({ blocking: ["coherence"], enforced: true })).toBe(
      true,
    )
  })

  it("does NOT block the same findings recorded in report-only", () => {
    expect(qualityBlocksRun({ blocking: ["coherence"], enforced: false })).toBe(
      false,
    )
  })

  it("does not block a clean enforced verdict", () => {
    expect(qualityBlocksRun({ blocking: [], enforced: true })).toBe(false)
  })
})

describe("a legacy run resuming across the deploy", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.durablePublish.mockResolvedValue({ ok: true, clipRecorded: true })
  })

  it("is still renderable at the pre-render point", async () => {
    // Resume point one: produce decides whether the paid work starts.
    const mastra = registerWorkflows()
    const state = await runToCompletion(
      mastra.getWorkflow("devotionalProduceWorkflow"),
      "legacy-produce",
      legacyContent(),
    )
    expect(state).toMatchObject({
      status: "success",
      result: { readyForRender: true },
    })
  })

  it("can still publish at the approval point", async () => {
    // Resume point two: the expensive work is already paid for. Refusing here is
    // the worst outcome available — money spent, nothing shipped — and it is what
    // happened before the two callers agreed.
    const mastra = registerWorkflows()
    const state = await runToCompletion(
      mastra.getWorkflow("devotionalPublishWorkflow"),
      "legacy-publish",
      {
        ...legacyContent(),
        portraitAsset: ASSET,
        wideAsset: { ...ASSET, artifactType: "devotional-output-wide-v1" },
        approved: true,
        approvedBy: { subject: "reviewer-1", role: "editor" as const },
      },
    )
    expect(state).toMatchObject({ status: "success" })
    if (state?.status !== "success") throw new Error("expected success")
    // Narrowed rather than optional-chained: `result` is optional on the run
    // state, and `?.` on it would quietly assert nothing at all.
    const result = state.result
    if (!result) throw new Error("expected a result")
    expect(result.status).not.toBe("blocked")
    expect(result.blockedBy).toBeUndefined()
  })
})
