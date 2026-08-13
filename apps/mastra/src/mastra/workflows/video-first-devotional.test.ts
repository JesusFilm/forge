import { beforeEach, describe, expect, it, vi } from "vitest"
import { Mastra } from "@mastra/core"
import { InMemoryStore } from "@mastra/core/storage"
import { LocalFilesystem, Workspace } from "@mastra/core/workspace"

import type { ProducedDevotionalAudio } from "../../services/devotional/devotional-audio"
import type { GeneratedDevotional } from "../../services/devotional/generate-devotional"
import { videoFirstDevotionalWorkflow } from "./video-first-devotional"
import { VideoFirstDevotionalWorkflowInputSchema } from "./video-first-devotional-schema"

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  record: vi.fn(),
  release: vi.fn(),
  publish: vi.fn(),
  durablePublish: vi.fn(),
  render: vi.fn(),
  verifyArtifacts: vi.fn(),
  verifySources: vi.fn(),
}))

vi.mock("../../services/devotional/workspace/postgres-used-clips", () => ({
  getPostgresUsedClipsStore: () => ({
    read: async () => ({ version: 1, used: {} }),
    reserve: mocks.reserve,
    record: mocks.record,
    release: mocks.release,
  }),
}))

vi.mock("../../services/devotional/devotional-worker-client", () => ({
  devotionalArtifactProxyPath: (artifact: {
    assetId: string
    artifactType: string
  }) =>
    `/forge-video-first-devotional/assets/${artifact.assetId}/${artifact.artifactType}/mp4`,
  renderDevotionalOnWorker: mocks.render,
  verifyDevotionalWorkerArtifacts: mocks.verifyArtifacts,
}))

vi.mock("../../services/devotional/site-publish-client", () => ({
  publishDevotional: mocks.publish,
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

vi.mock("../../config/env", async (importActual) => ({
  ...(await importActual()),
  // `env` is parsed once at module load, so setting process.env in a hook cannot
  // move it. Overriding the getter is what lets one suite cover both modes.
  isDevotionalQualityGateEnforced: () => qualityEnforced,
}))

vi.mock("../../services/devotional/safety-gate", async (importActual) => ({
  ...(await importActual()),
  evaluateSafety: async () => SAFETY,
}))

// The quality gate's three critics build their own LLMs from authored model
// config, so without this the suite would attempt real provider calls and the
// gate would fail closed on every run — blocking before the approval suspension
// these tests are about. Mutable so one case can flip it to a blocking verdict.
vi.mock(
  "../../services/devotional/devotional-quality-gate",
  async (importActual) => ({
    ...(await importActual()),
    reviewDevotionalText: async () => {
      if (qualityThrows) throw qualityThrows
      return { blocking: qualityBlocking }
    },
  }),
)

vi.mock("../../services/devotional/workspace/attempt-data", () => ({
  loadDevotionalAttemptAuthoredData: async () => ({
    prompts: {
      prompts: {
        scripture: "scripture",
        modernizer: "modernizer",
        highlighter: "highlighter",
        ranker: "ranker",
        copy: "copy",
        writer: "writer",
        hookNews: "news",
        hookQuestion: "question",
        videoMatcher: "video matcher",
        safety: "safety",
      },
      generation: {
        hookStyles: ["statement"],
        blockOrders: [["hook", "scripture", "video", "reflection"]],
        partnerDomains: [],
      },
    },
    safety: {
      minimumConfidence: 0.6,
      effectiveMinimumConfidence: 0.6,
      prompt: "safety",
    },
    holidays: {},
    voices: {
      profiles: { "male-d": "voice" },
      settings: {
        stability: 0.35,
        similarity_boost: 0.85,
        style: 0.45,
        use_speaker_boost: true,
      },
      rotation: ["male-d"],
      filterRotation: ["grain"],
    },
    music: {
      moods: { peace: "p", hope: "h", lament: "l", awe: "a" },
      defaultLengthMs: 60_000,
    },
    narration: {},
    brand: { name: "Jesus Film", rightsAssertion: "rights" },
    render: { filters: {}, layouts: {}, nativeLayouts: {} },
    chapters: [CHAPTER],
    passages: [CHAPTER],
    scripture: { verses: {} },
    corpora: { ryleMatthew: [], matthewHenry: [], spurgeon: [] },
  }),
}))

vi.mock("../../services/devotional/devotional-audio", async (importActual) => ({
  ...(await importActual()),
  produceDevotionalAudio: async () => AUDIO,
}))

vi.mock(
  "../../services/devotional/generate-devotional",
  async (importActual) => {
    const actual =
      await importActual<
        typeof import("../../services/devotional/generate-devotional")
      >()
    return {
      ...actual,
      sourceClipAndScripture: async () => ({
        chapter: CHAPTER,
        scripture: DEVO.scripture,
      }),
      composeDevotionalContent: async () => DEVO,
    }
  },
)

const CHAPTER = {
  index: 19,
  id: "1_jf6119-0-0",
  title: "Jesus Calms the Storm",
  start: "1:00:00",
  osisRef: "Luke.8.22-Luke.8.25",
  reference: "Luke 8:22-25",
  mood: "peace" as const,
  themes: ["peace"],
  clipStartSec: 5,
  clipLengthSec: 18,
}

const DEVO: GeneratedDevotional = {
  date: "2026-07-21",
  clip: { index: 19, id: CHAPTER.id, title: CHAPTER.title },
  passage: { reference: CHAPTER.reference, osisRef: CHAPTER.osisRef },
  title: "Peace in the Storm",
  scripture: {
    reference: "Luke 8:24",
    text: "He rebuked the wind and the raging water; and it was calm.",
    translation: "WEB",
    needsCanonicalSource: true,
  },
  reflection: {
    text: "Christ is with you in the boat.",
    source: "Matthew Henry",
    attribution: "Adapted from Matthew Henry",
    flavor: "commentary",
  },
  reflectionHighlights: ["with you"],
  conclusion: "The One who calms the sea is in your boat.",
  question: "What storm do you need to hand to Jesus today?",
  prayer: "Jesus, calm my storm.",
  mood: "peace",
  voice: "male-d",
  sequence: 0,
}

const AUDIO: ProducedDevotionalAudio = {
  voice: "male-d",
  segments: [],
  music: null,
  skipped: [],
}

const SAFETY = {
  verdict: "pass" as const,
  scores: { doctrine: 1, tone: 1, sensitivity: 1 },
  reasons: [],
}

/** Quality-gate verdict for the run under test. Empty = clean. */
let qualityBlocking: string[] = []
/** Set to simulate the gate itself failing (provider outage past its retries). */
let qualityThrows: Error | undefined
/** Enforcement mode for the run under test. Production defaults to report-only;
 *  these cases default to enforced so the blocking paths are exercised, and the
 *  report-only cases set it back explicitly. */
let qualityEnforced = true

const PORTRAIT = {
  assetId: "devo_run_1",
  artifactType: "devotional-output-portrait-v1" as const,
  ext: "mp4" as const,
}
const WIDE = {
  assetId: "devo_run_1",
  artifactType: "devotional-output-wide-v1" as const,
  ext: "mp4" as const,
}
const RESERVATION_ID = "49cb0cc4-2fdd-4edb-a1f6-d90664d2c885"

let registeredWorkflow: ReturnType<typeof registerWorkflow> | undefined

function registerWorkflow() {
  const mastra = new Mastra({
    workflows: { videoFirstDevotionalWorkflow },
    storage: new InMemoryStore({ id: "video-first-devotional-test" }),
    workspace: new Workspace({
      id: "video-first-devotional-test-workspace",
      name: "Video First Devotional Test Workspace",
      filesystem: new LocalFilesystem({
        id: "video-first-devotional-test-filesystem",
        basePath: "/tmp/video-first-devotional-test-workspace",
        contained: true,
      }),
      tools: { enabled: false },
    }),
  })
  return mastra.getWorkflow("videoFirstDevotionalWorkflow")
}

function workflowInput(runId: string) {
  return VideoFirstDevotionalWorkflowInputSchema.parse({
    chapterIndex: 19,
    date: "2026-07-21",
    workspaceGeneration: 1,
    attemptId: runId,
    selectedSources: [
      {
        path: "/inputs/reflections/grace.md",
        category: "reflections" as const,
        digest: "a".repeat(64),
        size: 42,
        modifiedAt: "2026-07-31T12:00:00.000Z",
        title: "grace",
      },
    ],
  })
}

async function startUntilSuspended(runId: string) {
  registeredWorkflow ??= registerWorkflow()
  const workflow = registeredWorkflow
  const run = await workflow.createRun({ runId })
  await run.startAsync({
    inputData: workflowInput(runId),
  })
  let state = await workflow.getWorkflowRunById(runId)
  for (
    let attempt = 0;
    attempt < 100 && state?.status !== "suspended";
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    state = await workflow.getWorkflowRunById(runId)
  }
  expect(state).toMatchObject({ status: "suspended" })
  expect(state?.steps).toMatchObject({
    "devotional-approve.await-approval": {
      suspendPayload: {
        portraitAsset: PORTRAIT,
        wideAsset: WIDE,
        portraitUrl: expect.stringContaining("/assets/"),
        wideUrl: expect.stringContaining("/assets/"),
      },
    },
  })
  return { workflow }
}

async function startAndResume(approved: boolean, runId: string) {
  const { workflow } = await startUntilSuspended(runId)
  const resumed = await workflow.createRun({ runId })
  return resumed.resume({
    resumeData: {
      approved,
      approvedBy: { subject: "reviewer-1", role: "editor" },
    },
  })
}

describe("video-first devotional workflow", () => {
  beforeEach(() => {
    qualityBlocking = []
    qualityThrows = undefined
    qualityEnforced = true
    vi.clearAllMocks()
    mocks.reserve.mockResolvedValue({
      chapter: CHAPTER,
      reservationId: RESERVATION_ID,
    })
    mocks.release.mockResolvedValue(true)
    mocks.record.mockResolvedValue(undefined)
    mocks.render.mockResolvedValue({ portrait: PORTRAIT, wide: WIDE })
    mocks.publish.mockResolvedValue({ ok: true, published: true })
    mocks.verifyArtifacts.mockResolvedValue(undefined)
    mocks.verifySources.mockResolvedValue(undefined)
    mocks.durablePublish.mockImplementation(async (input) => {
      const result = await input.send()
      if (result.ok && result.published) {
        await mocks.record(input.chapterId, input.reservationId)
      } else if (
        !(!result.ok && result.reason === "upstream_failed" && result.retryable)
      ) {
        await mocks.release(input.chapterId, input.reservationId)
      }
      return result
    })
  })

  it("renders, suspends with retrievable assets, publishes, then records the clip", async () => {
    const result = await startAndResume(true, "workflow-published")
    expect(result).toMatchObject({
      status: "success",
      result: {
        status: "published",
        portraitAsset: PORTRAIT,
        wideAsset: WIDE,
        clipRecorded: true,
      },
    })
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        devotional: expect.objectContaining({ prayer: DEVO.prayer }),
        videoAssets: { portrait: PORTRAIT, wide: WIDE },
      }),
    )
    expect(mocks.record).toHaveBeenCalledWith(CHAPTER.id, RESERVATION_ID)
  })

  it("releases the reservation without publishing when rejected", async () => {
    const result = await startAndResume(false, "workflow-rejected")
    expect(result).toMatchObject({
      status: "success",
      result: { status: "rejected", clipRecorded: false },
    })
    expect(mocks.publish).not.toHaveBeenCalled()
    expect(mocks.record).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledWith(CHAPTER.id, RESERVATION_ID)
  })

  // The quality gate sits with the safety gate between composed text and money:
  // ElevenLabs narration and the Worker render are both downstream. This case is
  // the one that would have caught the gate shipping unwired — it fails if the
  // reviewDevotionalText call is removed from contentStep, or if produceStep
  // stops consulting its verdict.
  it("does not render or narrate when the quality gate blocks", async () => {
    qualityBlocking = ["coherence: the reflection never touches the verse"]
    registeredWorkflow ??= registerWorkflow()
    const runId = "workflow-quality-blocked"
    const run = await registeredWorkflow.createRun({ runId })
    await run.startAsync({ inputData: workflowInput(runId) })

    // Wait for a TERMINAL state. Without this the assertions below pass whether
    // or not the gate is consulted, because the paid steps simply have not run
    // yet when startAsync resolves — the failure mode this test exists to catch
    // would sail through. Verified by removing the produceStep quality check:
    // that must turn this case red.
    let state = await registeredWorkflow.getWorkflowRunById(runId)
    for (
      let attempt = 0;
      attempt < 100 &&
      state?.status !== "success" &&
      state?.status !== "failed" &&
      state?.status !== "suspended";
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      state = await registeredWorkflow.getWorkflowRunById(runId)
    }

    // No approval suspension: there is nothing to approve when nothing rendered.
    expect(state?.status).not.toBe("suspended")
    expect(mocks.render).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
    // Not burned: a blocked devotional must not consume the clip.
    expect(mocks.record).not.toHaveBeenCalled()

    // WHY it was blocked has to survive to the result. Safety reads "pass" on a
    // quality block, so without `blockedBy` this run reported publish_failed /
    // rendered_assets_missing — a quality problem dressed as a render bug, which
    // is the wrong thing to hand an approver. The reasons ride along too.
    expect(state).toMatchObject({
      status: "success",
      result: {
        status: "blocked",
        blockedBy: "quality",
        quality: {
          blocking: ["coherence: the reflection never touches the verse"],
        },
      },
    })
    // NOTE deliberately not asserted: whether the reservation is RELEASED here.
    // It is not, on this path — the blocked run ends holding the clip. That is
    // the pre-existing safety-block behaviour too (produceStep returns
    // readyForRender:false without releasing), so it is not introduced here, and
    // pinning it either way would encode a decision nobody has made. Recorded as
    // a review finding instead.
  })

  // Vlad's rollout condition: the critics ship observing, not enforcing. A
  // finding must be recorded either way, and only enforcement may stop the paid
  // work — otherwise a provider outage costs a day's devotional before anyone
  // knows the false-positive rate.
  describe("report-only mode", () => {
    it("records the finding and still renders", async () => {
      qualityEnforced = false
      qualityBlocking = ["coherence: the reflection never touches the verse"]
      const result = await startAndResume(true, "workflow-report-only")

      // The paid work went ahead...
      expect(mocks.render).toHaveBeenCalled()
      // ...and the verdict is on the record with the mode it ran under, so the
      // finding is countable later without guessing whether it was acted on.
      expect(result).toMatchObject({
        status: "success",
        result: {
          status: "published",
          quality: {
            enforced: false,
            blocking: ["coherence: the reflection never touches the verse"],
          },
        },
      })
      // Narrowed rather than optional-chained: the union includes a failed shape
      // with no `result` at all, and `?.` on that would quietly assert nothing.
      expect(result.status).toBe("success")
      if (result.status !== "success") throw new Error("expected success")
      expect(result.result.blockedBy).toBeUndefined()
    })

    it("still renders when the gate itself fails, so an outage costs nothing", async () => {
      // The gate throwing is the provider-outage shape: past its own retries,
      // every critic gone. Under enforcement that is a block by design; in
      // report-only it must not be, which is the whole reason for the mode.
      qualityEnforced = false
      qualityThrows = new Error("openrouter unavailable")
      const result = await startAndResume(true, "workflow-report-only-outage")
      expect(mocks.render).toHaveBeenCalled()
      expect(result).toMatchObject({
        status: "success",
        result: { status: "published" },
      })
    })
  })

  it("blocks when the gate itself fails under enforcement", async () => {
    // Same outage, enforcement on: fail closed. "We could not check" must never
    // read as "it passed", so the paid work does not start.
    qualityThrows = new Error("openrouter unavailable")
    registeredWorkflow ??= registerWorkflow()
    const runId = "workflow-enforced-outage"
    const run = await registeredWorkflow.createRun({ runId })
    await run.startAsync({ inputData: workflowInput(runId) })
    let state = await registeredWorkflow.getWorkflowRunById(runId)
    for (
      let attempt = 0;
      attempt < 100 &&
      state?.status !== "success" &&
      state?.status !== "failed" &&
      state?.status !== "suspended";
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      state = await registeredWorkflow.getWorkflowRunById(runId)
    }
    expect(mocks.render).not.toHaveBeenCalled()
    expect(state?.status).not.toBe("suspended")
  })

  it("returns publish_skipped and does not burn the clip when config is absent", async () => {
    mocks.publish.mockResolvedValue({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
    const result = await startAndResume(true, "workflow-skipped")
    expect(result).toMatchObject({
      status: "success",
      result: {
        status: "publish_skipped",
        publishReason: "config_missing",
        clipRecorded: false,
      },
    })
    expect(mocks.record).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledWith(CHAPTER.id, RESERVATION_ID)
  })

  it("fails without releasing after receiver acceptance cannot be committed", async () => {
    mocks.record.mockRejectedValue(new Error("ledger disk unavailable"))
    const result = await startAndResume(true, "workflow-ledger-failed")
    expect(result).toMatchObject({
      status: "failed",
    })
    expect(mocks.release).not.toHaveBeenCalled()
  })

  it("releases the clip when approval-time artifact verification fails", async () => {
    const { workflow } = await startUntilSuspended("approval-integrity")
    mocks.verifyArtifacts.mockRejectedValueOnce(new Error("artifact changed"))

    const resumed = await workflow.createRun({ runId: "approval-integrity" })
    await expect(
      resumed.resume({
        resumeData: {
          approved: true,
          approvedBy: { subject: "reviewer-1", role: "editor" },
        },
      }),
    ).resolves.toMatchObject({ status: "failed" })
    expect(mocks.release).toHaveBeenCalledWith(CHAPTER.id, RESERVATION_ID)
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it("releases the clip when a selected source changes before approval resumes", async () => {
    const { workflow } = await startUntilSuspended("approval-source-changed")
    mocks.verifySources.mockRejectedValueOnce(new Error("source changed"))

    const resumed = await workflow.createRun({
      runId: "approval-source-changed",
    })
    await expect(
      resumed.resume({
        resumeData: {
          approved: true,
          approvedBy: { subject: "reviewer-1", role: "editor" },
        },
      }),
    ).resolves.toMatchObject({ status: "failed" })
    expect(mocks.release).toHaveBeenCalledWith(CHAPTER.id, RESERVATION_ID)
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it("releases the clip when pre-publish artifact verification fails", async () => {
    mocks.verifyArtifacts
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("artifact changed"))
    const result = await startAndResume(true, "publish-integrity")

    expect(result).toMatchObject({ status: "failed" })
    expect(mocks.release).toHaveBeenCalledWith(CHAPTER.id, RESERVATION_ID)
    expect(mocks.publish).not.toHaveBeenCalled()
  })
})
