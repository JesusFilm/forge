import { beforeEach, describe, expect, it, vi } from "vitest"
import { Mastra } from "@mastra/core"
import { InMemoryStore } from "@mastra/core/storage"

import type { ProducedDevotionalAudio } from "../../services/devotional/devotional-audio"
import type { GeneratedDevotional } from "../../services/devotional/generate-devotional"
import { videoFirstDevotionalWorkflow } from "./video-first-devotional"

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  record: vi.fn(),
  release: vi.fn(),
  publish: vi.fn(),
  render: vi.fn(),
}))

vi.mock("../../services/devotional/used-clips-ledger", () => ({
  createUsedClipsStore: () => ({
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
}))

vi.mock("../../services/devotional/site-publish-client", () => ({
  publishDevotional: mocks.publish,
}))

vi.mock("../../services/devotional/safety-gate", async (importActual) => ({
  ...(await importActual()),
  evaluateSafety: async () => SAFETY,
}))

vi.mock("../../services/devotional/devotional-cache", () => ({
  cacheDirFor: () => "/tmp/devotional-cache-test",
  clearCachedDevotional: async () => undefined,
  loadCachedAudio: async () => AUDIO,
  loadCachedDevo: async () => null,
  saveCachedAudio: async () => undefined,
  saveCachedDevo: async () => undefined,
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
  })
  return mastra.getWorkflow("videoFirstDevotionalWorkflow")
}

async function startAndResume(approved: boolean, runId: string) {
  registeredWorkflow ??= registerWorkflow()
  const workflow = registeredWorkflow
  const run = await workflow.createRun({ runId })
  await run.startAsync({
    inputData: {
      chapterIndex: 19,
      date: "2026-07-21",
      regenerate: false,
      regenerateAudio: false,
    },
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
    vi.clearAllMocks()
    mocks.reserve.mockResolvedValue({
      chapter: CHAPTER,
      reservationId: RESERVATION_ID,
    })
    mocks.release.mockResolvedValue(true)
    mocks.record.mockResolvedValue(undefined)
    mocks.render.mockResolvedValue({ portrait: PORTRAIT, wide: WIDE })
    mocks.publish.mockResolvedValue({ ok: true, published: true })
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

  it("stays terminal-published if post-publish ledger recording fails", async () => {
    mocks.record.mockRejectedValue(new Error("ledger disk unavailable"))
    const result = await startAndResume(true, "workflow-ledger-failed")
    expect(result).toMatchObject({
      status: "success",
      result: {
        status: "published",
        clipRecorded: false,
        publishReason: "ledger_record_failed",
      },
    })
    expect(mocks.release).not.toHaveBeenCalled()
  })
})
