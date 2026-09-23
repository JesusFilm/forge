import { createHash } from "node:crypto"
import { beforeEach, expect, test, vi } from "vitest"
import {
  studioInspectionContextSchema,
  type StudioInspectionEvidence,
} from "@forge/studio-contracts/inspection"
import {
  inspectStudioRender,
  boundedInspectionCall,
  studioInspectionMcpResult,
} from "./studio-inspection"
import { extractStudioInspection } from "./studio-inspection-output"
import { createStudioAssetBroker } from "./studio-broker"
import { studioRenderClient } from "./studio-render-transport"

vi.mock("@/config/env", () => ({ env: {} }))
vi.mock("./studio-broker", () => ({ createStudioAssetBroker: vi.fn() }))
vi.mock("./studio-render-transport", () => ({ studioRenderClient: vi.fn() }))
vi.mock("./studio-inspection-output", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./studio-inspection-output")>()),
  extractStudioInspection: vi.fn(),
}))
const input = { projectId: "project", attemptId: "render" }
const context = studioInspectionContextSchema.parse({
  ...input,
  revision: 1,
  currentRevision: 1,
  stale: false,
  inputHash: "a".repeat(64),
  output: { assetId: "output", versionId: "v1", digest: "b".repeat(64) },
  outputReadyAt: "2026-09-23T00:00:00.000Z",
  document: {
    version: 1,
    title: "Fixture",
    language: "en",
    runtimeVersion: "test",
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 30,
    tracks: [],
    items: [],
    components: [],
    packRevisionIds: [],
  },
  evidence: null,
})
const imageBytes = Buffer.from([255, 216, 255, 217])
const evidence: StudioInspectionEvidence = {
  ...input,
  version: "shorts-output-inspection-1",
  revision: 1,
  inputHash: context.inputHash,
  output: context.output,
  durationMs: 1000,
  outputReadyAt: context.outputReadyAt,
  preparationStartedAt: context.outputReadyAt,
  evidenceReadyAt: context.outputReadyAt,
  preparationMs: 1,
  status: "sampled",
  advisoryOnly: true,
  samples: [
    {
      frame: 0,
      timestampMs: 0,
      reasons: ["representative"],
      blackPercent: 0,
      image: {
        mimeType: "image/jpeg",
        data: imageBytes.toString("base64"),
        digest: createHash("sha256").update(imageBytes).digest("hex"),
      },
    },
  ],
  coverage: {
    totalFrames: 30,
    requestedFrames: [0],
    cutCount: 0,
    sampledCutCount: 0,
    authoredGaps: [],
    gapIntent: "not-recorded; confirm intentional gaps with the author",
    audio: {
      status: "unavailable",
      startMs: 0,
      endMs: 0,
      monoSampleRate: 8000,
      rms: null,
      peak: null,
      nearFullscaleFraction: null,
      silence: [],
    },
  },
  findings: [],
  limitations: ["Transport fixture only"],
  toolchain: { ffmpeg: "fixture", ffprobe: "fixture" },
}
beforeEach(() => vi.clearAllMocks())
test("retries unsupported extraction without a render, caches successful evidence, and rechecks human edits", async () => {
  let cached: StudioInspectionEvidence | null = null
  const read = vi.fn(async () => ({
    ...context,
    evidence: cached,
    currentRevision: 2,
    stale: true,
  }))
  const bytes = vi.fn(async () => Buffer.from("retained output"))
  vi.mocked(createStudioAssetBroker).mockReturnValue({
    read: bytes,
    register: vi.fn(),
  })
  const save = vi.fn(async (_command: string, value: unknown) => {
    cached = value as StudioInspectionEvidence
    return value
  })
  vi.mocked(studioRenderClient).mockReturnValue({ call: save, assets: vi.fn() })
  vi.mocked(extractStudioInspection)
    .mockResolvedValueOnce({ ...evidence, status: "unsupported", samples: [] })
    .mockImplementation(async () => structuredClone(evidence))
  const unsupported = await inspectStudioRender(read, input)
  expect(unsupported.evidence.status).toBe("unsupported")
  expect(save).not.toHaveBeenCalled()
  const success = await inspectStudioRender(read, input)
  expect(success.stale).toBe(true)
  expect(success.currentRevision).toBe(2)
  expect(save).toHaveBeenCalledTimes(1)
  expect(save.mock.calls[0]?.[0]).toBe("inspection-save")
  const repeated = await inspectStudioRender(read, input)
  expect(repeated.cacheHit).toBe(true)
  expect(repeated.evidence).toEqual(success.evidence)
  expect(bytes).toHaveBeenCalledTimes(2)
  expect(extractStudioInspection).toHaveBeenCalledTimes(2)
  expect(read.mock.calls.length).toBe(5)
})
test("delivers usable MCP image content with sample labels and no duplicated base64 report", () => {
  const result = studioInspectionMcpResult({
    evidence,
    stale: false,
    currentRevision: 1,
    cacheHit: true,
    serverRequestMs: 1,
  })
  expect(result.content[2]).toEqual({
    type: "image",
    mimeType: "image/jpeg",
    data: imageBytes.toString("base64"),
  })
  expect(result.content[1]).toMatchObject({
    type: "text",
    text: expect.stringContaining("frame 0"),
  })
  expect(
    result.structuredContent.result.evidence.samples[0]?.image,
  ).toMatchObject({
    contentIndex: 2,
    digest: evidence.samples[0]!.image.digest,
  })
  expect(
    result.structuredContent.result.evidence.samples[0]?.image,
  ).not.toHaveProperty("data")
})

test("bounds a hung initial context and does not invoke byte extraction", async () => {
  const controller = new AbortController()
  const pending = boundedInspectionCall(
    async () => new Promise(() => {}),
    "inspection-context",
    input,
    controller.signal,
  )
  controller.abort(new DOMException("fixture deadline", "TimeoutError"))
  await expect(pending).rejects.toMatchObject({ name: "TimeoutError" })
  expect(extractStudioInspection).not.toHaveBeenCalled()
})

test("a hung asset grant returns uncached incomplete coverage and frees the process slot", async () => {
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal)
  const controller = new AbortController()
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockImplementation((ms) =>
      ms === 45000 ? controller.signal : originalTimeout(ms),
    )
  let entered: () => void = () => {}
  const ready = new Promise<void>((resolve) => {
    entered = resolve
  })
  const read = vi.fn(async (action: string) =>
    action === "inspection-context" ? context : new Promise(() => {}),
  )
  vi.mocked(createStudioAssetBroker).mockImplementation((call) => ({
    read: async () => {
      entered()
      await call("asset-read", context.output)
      return Buffer.alloc(0)
    },
    register: vi.fn(),
  }))
  const save = vi.fn(async (_command: string, value: unknown) => value)
  vi.mocked(studioRenderClient).mockReturnValue({ call: save, assets: vi.fn() })
  try {
    const pending = inspectStudioRender(read, input)
    await ready
    controller.abort(new DOMException("fixture grant deadline", "TimeoutError"))
    const result = await pending
    expect(result.evidence.status).toBe("incomplete")
    expect(result.evidence.samples).toEqual([])
    expect(result.evidence.coverage.audio.status).toBe("unavailable")
    expect(save).not.toHaveBeenCalled()
    expect(extractStudioInspection).not.toHaveBeenCalled()
  } finally {
    timeout.mockRestore()
  }
  vi.mocked(createStudioAssetBroker).mockReturnValue({
    read: vi.fn(async () => Buffer.from("bytes")),
    register: vi.fn(),
  })
  vi.mocked(extractStudioInspection).mockResolvedValue(
    structuredClone(evidence),
  )
  expect((await inspectStudioRender(read, input)).evidence.status).toBe(
    "sampled",
  )
})
