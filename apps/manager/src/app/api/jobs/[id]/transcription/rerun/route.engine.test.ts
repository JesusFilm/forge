import { beforeEach, expect, it, vi } from "vitest"
import type { JobRecord } from "@/types/job"

const { fixture, launch, restamp, selectEngine } = vi.hoisted(() => ({
  fixture: {
    id: "dummy-job",
    muxAssetId: "dummy-asset",
    muxPlaybackId: "dummy-playback",
    languages: ["fr"],
    sourceLanguageCode: "en",
    options: { engine: "mastra", currentRunId: "old-run" },
    status: "failed",
    artifacts: {},
    steps: [],
    errors: [],
    retries: 0,
    createdAt: "",
    updatedAt: "",
  },
  launch: vi.fn(),
  restamp: vi.fn(),
  selectEngine: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ authenticateRequest: async () => null }))
vi.mock("@/lib/state", () => ({
  getJob: async () => fixture,
  resetEnrichmentForRerun: async (_id: string, artifacts: unknown) => ({
    ...fixture,
    artifacts,
    options: { engine: "mastra" },
    status: "pending",
  }),
  updateJob: vi.fn(),
  restampEngine: restamp,
}))
vi.mock("@/lib/enrichment-engine", () => ({
  resolveEnrichmentEngine: selectEngine,
}))
vi.mock("@/services/elevenlabs-transcription", () => ({
  isSupportedElevenLabsLanguage: () => true,
}))
vi.mock("@/services/audioCleanup", () => ({
  isAudioCleanupConfigured: () => false,
}))
vi.mock("@/services/mux", () => ({
  getMuxAsset: vi.fn(),
  getMuxStaticRenditionSourceUrl: vi.fn(),
}))
vi.mock("@/services/transcription", () => ({
  normalizeSourceLanguageCode: () => "en",
}))
vi.mock("@/workflows/launchVideoEnrichment", () => ({
  launchVideoEnrichment: launch,
}))
import { POST } from "./route"

const rerun = () =>
  POST(
    new Request("https://manager.test/api/jobs/dummy-job/transcription/rerun", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "mux" }),
    }),
    { params: Promise.resolve({ id: "dummy-job" }) },
  )

beforeEach(() => {
  vi.resetAllMocks()
  selectEngine.mockResolvedValue("workflow")
})

it.each(["null", "error", "stale-stamp"])(
  "does not launch when rollback restamping returns %s",
  async (mode) => {
    if (mode === "error")
      restamp.mockRejectedValueOnce(new Error("dummy storage down"))
    else restamp.mockResolvedValueOnce(mode === "null" ? null : fixture)
    const response = await rerun()
    expect(restamp).toHaveBeenCalledWith("dummy-job", "workflow")
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: "engine_persistence_failed",
      retryable: true,
    })
    expect(launch).not.toHaveBeenCalled()
  },
)

it.each(["workflow", "mastra"] as const)(
  "launches only after the selected %s stamp is persisted",
  async (engine) => {
    selectEngine.mockResolvedValueOnce(engine)
    let saved: JobRecord | undefined
    restamp.mockImplementationOnce(
      async (_id: string, selected: "workflow" | "mastra") => {
        saved = {
          ...fixture,
          status: "pending",
          options: { engine: selected },
        } as JobRecord
        return saved
      },
    )
    launch.mockImplementationOnce(async () => {
      expect(saved?.options.engine).toBe(engine)
    })
    const response = await rerun()
    expect(response.status).toBe(202)
    expect(restamp).toHaveBeenCalledWith("dummy-job", engine)
    expect(launch).toHaveBeenCalledOnce()
    expect(restamp.mock.invocationCallOrder[0]).toBeLessThan(
      launch.mock.invocationCallOrder[0]!,
    )
  },
)
