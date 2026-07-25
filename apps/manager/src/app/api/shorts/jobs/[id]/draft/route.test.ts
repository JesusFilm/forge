import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JobRecord, ShortsPhase } from "@/types/job"

const {
  authenticateManagerOverrideRequestMock,
  authenticateRequestMock,
  getJobMock,
  mergeShortsReportEntryMock,
  artifactExistsMock,
  readArtifactMock,
  readShortsDraftMock,
  writeShortsDraftMock,
} = vi.hoisted(() => ({
  authenticateManagerOverrideRequestMock: vi.fn(),
  authenticateRequestMock: vi.fn(),
  getJobMock: vi.fn(),
  mergeShortsReportEntryMock: vi.fn(),
  artifactExistsMock: vi.fn(),
  readArtifactMock: vi.fn(),
  readShortsDraftMock: vi.fn(),
  writeShortsDraftMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateManagerOverrideRequest: authenticateManagerOverrideRequestMock,
  authenticateRequest: authenticateRequestMock,
  managerActorIdentity: (actor: {
    kind: string
    user?: { email: string }
    approvedByUserId: string
  }) =>
    actor.kind === "session"
      ? actor.user?.email || actor.approvedByUserId
      : actor.approvedByUserId,
}))

vi.mock("@/lib/state", () => ({
  getJob: getJobMock,
  mergeShortsReportEntry: mergeShortsReportEntryMock,
}))

vi.mock("@/services/storage", () => ({
  artifactExists: artifactExistsMock,
  readArtifact: readArtifactMock,
}))

vi.mock("@/lib/shorts-draft", () => ({
  readShortsDraft: readShortsDraftMock,
  writeShortsDraft: writeShortsDraftMock,
}))

const { GET, POST } = await import("@/app/api/shorts/jobs/[id]/draft/route")

const sessionActor = {
  kind: "session" as const,
  user: {
    id: "user-1",
    username: "op",
    email: "op@jesusfilm.org",
    role: { name: "Manager" as const, type: "manager" as const },
  },
  approvedByUserId: "user-1",
}

const CAPTIONS_GENERATED_AT = "2026-06-11T01:00:00.000Z"

function buildShortsJob(
  phase: ShortsPhase = "ready_for_review",
  overrides: Partial<JobRecord> = {},
): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "mux-1",
    muxPlaybackId: "pbpublic",
    languages: [],
    options: {
      shorts: {
        assetId: "mux-1-short-abcd1234",
        sourceMuxAssetId: "mux-1",
        sourcePlaybackId: "pbpublic",
        clip: { startSec: 10, endSec: 40 },
        language: { bcp47: "en", whisper: "en" },
      },
    },
    status: "completed",
    retries: 0,
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    artifacts: {
      shorts: {
        kind: "metadata",
        data: {
          domain: "shorts",
          phase,
          annotation: null,
          hasAudio: true,
          clipDurationSec: 30,
          captionsCount: 42,
          draftVersion: 1,
          lastRenderedDraftVersion: null,
          lastRenderedPropsHash: null,
          output: { muxAssetId: null, playbackId: null, ready: false },
          updatedAt: "2026-06-11T00:00:00.000Z",
        },
      },
    },
    steps: [],
    errors: [],
    ...overrides,
  }
}

function validDraft() {
  return {
    templateId: "focus",
    accentColor: "#facc15",
    captionPosition: "lower",
    captionFont: "montserrat",
    waveformStyle: "bars",
    showCaptions: true,
    captionPages: [
      {
        text: "Hello world",
        startMs: 0,
        durationMs: 1200,
        tokens: [
          { text: "Hello", fromMs: 0, toMs: 500 },
          { text: " world", fromMs: 500, toMs: 1200 },
        ],
      },
    ],
  }
}

function postRequest(body: unknown): Request {
  return new Request("http://example.test/api/shorts/jobs/job-1/draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const routeParams = { params: Promise.resolve({ id: "job-1" }) }

const CAPTIONS_ARTIFACT_JSON = {
  captions: [
    {
      text: "Hello",
      startMs: 0,
      endMs: 500,
      timestampMs: 250,
      confidence: null,
    },
    {
      text: " world",
      startMs: 500,
      endMs: 1200,
      timestampMs: 800,
      confidence: null,
    },
  ],
  language: "en",
  model: "large-v3-turbo",
  annotation: null,
  generatedAt: CAPTIONS_GENERATED_AT,
}

const CLIP_META_ARTIFACT_JSON = {
  sourceHost: "stream.mux.com",
  clip: { startSec: 10, endSec: 40 },
  durationSec: 30,
  fps: 29.97,
  width: 1920,
  height: 1080,
  hasAudio: true,
  generatedAt: "2026-06-11T00:59:00.000Z",
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function getRequest(): Request {
  return new Request("http://example.test/api/shorts/jobs/job-1/draft")
}

beforeEach(() => {
  authenticateManagerOverrideRequestMock.mockReset()
  authenticateRequestMock.mockReset()
  getJobMock.mockReset()
  mergeShortsReportEntryMock.mockReset()
  artifactExistsMock.mockReset()
  readArtifactMock.mockReset()
  readShortsDraftMock.mockReset()
  writeShortsDraftMock.mockReset()

  authenticateManagerOverrideRequestMock.mockResolvedValue(sessionActor)
  authenticateRequestMock.mockResolvedValue(null)
  getJobMock.mockResolvedValue(buildShortsJob())
  mergeShortsReportEntryMock.mockResolvedValue(buildShortsJob())
  artifactExistsMock.mockResolvedValue(true)
  readArtifactMock.mockImplementation(
    (_assetId: string, artifactType: string) =>
      Promise.resolve(
        artifactType === "shorts-clip-meta-v1"
          ? encodeJson(CLIP_META_ARTIFACT_JSON)
          : encodeJson(CAPTIONS_ARTIFACT_JSON),
      ),
  )
  readShortsDraftMock.mockResolvedValue({
    draftVersion: 3,
    captionsGeneratedAt: CAPTIONS_GENERATED_AT,
    updatedBy: "system:shorts-prepare",
    updatedAt: "2026-06-11T00:30:00.000Z",
    draft: validDraft(),
  })
  writeShortsDraftMock.mockResolvedValue(undefined)
})

describe("GET /api/shorts/jobs/[id]/draft", () => {
  it("rejects unauthorized callers", async () => {
    const { NextResponse } = await import("next/server")
    authenticateRequestMock.mockResolvedValue(
      NextResponse.json({ error: "auth required" }, { status: 401 }),
    )

    const response = await GET(getRequest(), routeParams)
    expect(response.status).toBe(401)
  })

  it("returns 404 for unknown jobs", async () => {
    getJobMock.mockResolvedValue(null)

    const response = await GET(getRequest(), routeParams)
    expect(response.status).toBe(404)
  })

  it("returns 404 not_shorts_job for non-shorts jobs", async () => {
    getJobMock.mockResolvedValue(
      buildShortsJob("ready_for_review", { options: {} }),
    )

    const response = await GET(getRequest(), routeParams)
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      reason: "not_shorts_job",
    })
  })

  it("returns the stored draft, captions summary, and clip meta", async () => {
    const response = await GET(getRequest(), routeParams)
    expect(response.status).toBe(200)

    const payload = (await response.json()) as {
      draft: { draftVersion: number; draft: { templateId: string } }
      captions: Record<string, unknown>
      clipMeta: Record<string, unknown>
    }

    expect(payload.draft.draftVersion).toBe(3)
    expect(payload.draft.draft.templateId).toBe("focus")
    expect(payload.captions).toEqual({
      generatedAt: CAPTIONS_GENERATED_AT,
      count: 2,
      annotation: null,
      language: "en",
    })
    // fps is rounded to match the render path's resolveShortInputProps.
    expect(payload.clipMeta).toEqual({
      durationSec: 30,
      fps: 30,
      hasAudio: true,
    })
  })

  it("returns null fields before prepare has produced artifacts", async () => {
    readShortsDraftMock.mockResolvedValue(null)
    artifactExistsMock.mockResolvedValue(false)

    const response = await GET(getRequest(), routeParams)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      draft: null,
      captions: null,
      clipMeta: null,
    })
  })

  it("nulls malformed artifacts instead of failing", async () => {
    readArtifactMock.mockImplementation(() =>
      Promise.resolve(encodeJson({ nope: true })),
    )

    const response = await GET(getRequest(), routeParams)
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      draft: unknown
      captions: unknown
      clipMeta: unknown
    }
    expect(payload.captions).toBeNull()
    expect(payload.clipMeta).toBeNull()
    // The draft read goes through readShortsDraft (mocked healthy here).
    expect(payload.draft).not.toBeNull()
  })

  it("surfaces the captions annotation for skipped transcription", async () => {
    readArtifactMock.mockImplementation(
      (_assetId: string, artifactType: string) =>
        Promise.resolve(
          artifactType === "shorts-clip-meta-v1"
            ? encodeJson({ ...CLIP_META_ARTIFACT_JSON, hasAudio: false })
            : encodeJson({
                ...CAPTIONS_ARTIFACT_JSON,
                captions: [],
                language: null,
                annotation: "transcription_skipped_no_audio",
              }),
        ),
    )

    const response = await GET(getRequest(), routeParams)
    const payload = (await response.json()) as {
      captions: { count: number; annotation: string; language: null }
      clipMeta: { hasAudio: boolean }
    }
    expect(payload.captions.count).toBe(0)
    expect(payload.captions.annotation).toBe("transcription_skipped_no_audio")
    expect(payload.clipMeta.hasAudio).toBe(false)
  })
})

describe("POST /api/shorts/jobs/[id]/draft", () => {
  it("rejects unauthorized callers", async () => {
    const { NextResponse } = await import("next/server")
    authenticateManagerOverrideRequestMock.mockResolvedValue(
      NextResponse.json({ error: "auth required" }, { status: 403 }),
    )

    const response = await POST(
      postRequest({ draft: validDraft() }),
      routeParams,
    )
    expect(response.status).toBe(403)
    expect(writeShortsDraftMock).not.toHaveBeenCalled()
  })

  it("returns 404 for unknown jobs", async () => {
    getJobMock.mockResolvedValue(null)

    const response = await POST(
      postRequest({ draft: validDraft() }),
      routeParams,
    )
    expect(response.status).toBe(404)
  })

  it("returns 409 not_shorts_job for non-shorts jobs", async () => {
    getJobMock.mockResolvedValue(
      buildShortsJob("ready_for_review", { options: {} }),
    )

    const response = await POST(
      postRequest({ draft: validDraft() }),
      routeParams,
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      reason: "not_shorts_job",
    })
  })

  it.each<ShortsPhase>([
    "queued",
    "preparing",
    "rendering",
    "mux_processing",
    "prepare_failed",
  ])(
    "rejects draft saves with 409 phase_invalid during phase %s",
    async (phase) => {
      getJobMock.mockResolvedValue(buildShortsJob(phase))

      const response = await POST(
        postRequest({ draft: validDraft() }),
        routeParams,
      )
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({
        reason: "phase_invalid",
        phase,
      })
      expect(writeShortsDraftMock).not.toHaveBeenCalled()
    },
  )

  it.each<ShortsPhase>(["ready_for_review", "render_failed", "completed"])(
    "allows draft saves in phase %s",
    async (phase) => {
      getJobMock.mockResolvedValue(buildShortsJob(phase))

      const response = await POST(
        postRequest({ draft: validDraft() }),
        routeParams,
      )
      expect(response.status).toBe(200)
    },
  )

  it("rejects payloads carrying server-injected fields via the strict schema", async () => {
    const smuggled = {
      ...validDraft(),
      clipUrl: "http://127.0.0.1:9999/clip.mp4",
    }

    const response = await POST(postRequest({ draft: smuggled }), routeParams)
    expect(response.status).toBe(400)
    expect(writeShortsDraftMock).not.toHaveBeenCalled()

    for (const [key, value] of [
      ["fps", 60],
      ["clipDurationSec", 9999],
      ["hasAudio", false],
    ] as const) {
      const variant = await POST(
        postRequest({ draft: { ...validDraft(), [key]: value } }),
        routeParams,
      )
      expect(variant.status).toBe(400)
    }
  })

  it("rejects bodies without a draft", async () => {
    const response = await POST(postRequest({}), routeParams)
    expect(response.status).toBe(400)
  })

  it("increments draftVersion server-side and mirrors it into the report", async () => {
    const response = await POST(
      postRequest({ draft: validDraft() }),
      routeParams,
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ draftVersion: 4 })

    expect(writeShortsDraftMock).toHaveBeenCalledWith(
      "mux-1-short-abcd1234",
      expect.objectContaining({
        draftVersion: 4,
        captionsGeneratedAt: CAPTIONS_GENERATED_AT,
        updatedBy: "op@jesusfilm.org",
      }),
    )

    expect(mergeShortsReportEntryMock).toHaveBeenCalledWith("job-1", {
      draftVersion: 4,
    })
  })

  it("patches ONLY draftVersion — a save racing a render workflow cannot revert the phase", async () => {
    // Lost-update regression (todo 011): the gate read saw
    // "ready_for_review", but by write time a render workflow may have moved
    // the persisted phase to "rendering". The mirror write must carry NO
    // phase at all — mergeShortsReportEntry re-reads the current entry inside
    // the per-job lock, so the workflow-owned phase survives structurally.
    const response = await POST(
      postRequest({ draft: validDraft() }),
      routeParams,
    )
    expect(response.status).toBe(200)

    expect(mergeShortsReportEntryMock).toHaveBeenCalledTimes(1)
    const [, patch] = mergeShortsReportEntryMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    expect(patch).toEqual({ draftVersion: 4 })
    expect(patch).not.toHaveProperty("phase")
  })

  it("starts at draftVersion 1 when no draft exists yet", async () => {
    readShortsDraftMock.mockResolvedValue(null)

    const response = await POST(
      postRequest({ draft: validDraft() }),
      routeParams,
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ draftVersion: 1 })
  })

  it("ignores body-supplied updatedBy/draftVersion — audit fields come from the actor", async () => {
    const response = await POST(
      postRequest({
        draft: validDraft(),
        updatedBy: "attacker@example.test",
        draftVersion: 999,
      }),
      routeParams,
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ draftVersion: 4 })

    const artifact = writeShortsDraftMock.mock.calls[0]?.[1] as {
      updatedBy: string
      draftVersion: number
    }
    expect(artifact.updatedBy).toBe("op@jesusfilm.org")
    expect(artifact.draftVersion).toBe(4)
  })

  it("records the service principal for API-key callers", async () => {
    authenticateManagerOverrideRequestMock.mockResolvedValue({
      kind: "api_key",
      approvedByUserId: "service:manager-api-key",
    })

    const response = await POST(
      postRequest({ draft: validDraft() }),
      routeParams,
    )
    expect(response.status).toBe(200)
    const artifact = writeShortsDraftMock.mock.calls[0]?.[1] as {
      updatedBy: string
    }
    expect(artifact.updatedBy).toBe("service:manager-api-key")
  })

  it("returns 409 captions_missing when no captions artifact exists", async () => {
    artifactExistsMock.mockResolvedValue(false)

    const response = await POST(
      postRequest({ draft: validDraft() }),
      routeParams,
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      reason: "captions_missing",
    })
    expect(writeShortsDraftMock).not.toHaveBeenCalled()
  })

  it("returns 409 captions_missing when the captions artifact is malformed", async () => {
    readArtifactMock.mockResolvedValue(
      new TextEncoder().encode(JSON.stringify({ nope: true })),
    )

    const response = await POST(
      postRequest({ draft: validDraft() }),
      routeParams,
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      reason: "captions_missing",
    })
  })
})
