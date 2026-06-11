import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JobRecord, ShortsPhase } from "@/types/job"

const {
  authenticateManagerOverrideRequestMock,
  getJobMock,
  mergeJobArtifactsMock,
  artifactExistsMock,
  readArtifactMock,
  readShortsDraftMock,
  writeShortsDraftMock,
} = vi.hoisted(() => ({
  authenticateManagerOverrideRequestMock: vi.fn(),
  getJobMock: vi.fn(),
  mergeJobArtifactsMock: vi.fn(),
  artifactExistsMock: vi.fn(),
  readArtifactMock: vi.fn(),
  readShortsDraftMock: vi.fn(),
  writeShortsDraftMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateManagerOverrideRequest: authenticateManagerOverrideRequestMock,
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
  mergeJobArtifacts: mergeJobArtifactsMock,
}))

vi.mock("@/services/storage", () => ({
  artifactExists: artifactExistsMock,
  readArtifact: readArtifactMock,
}))

vi.mock("@/lib/shorts-draft", () => ({
  readShortsDraft: readShortsDraftMock,
  writeShortsDraft: writeShortsDraftMock,
}))

const { POST } = await import("@/app/api/shorts/jobs/[id]/draft/route")

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

beforeEach(() => {
  authenticateManagerOverrideRequestMock.mockReset()
  getJobMock.mockReset()
  mergeJobArtifactsMock.mockReset()
  artifactExistsMock.mockReset()
  readArtifactMock.mockReset()
  readShortsDraftMock.mockReset()
  writeShortsDraftMock.mockReset()

  authenticateManagerOverrideRequestMock.mockResolvedValue(sessionActor)
  getJobMock.mockResolvedValue(buildShortsJob())
  mergeJobArtifactsMock.mockResolvedValue(buildShortsJob())
  artifactExistsMock.mockResolvedValue(true)
  readArtifactMock.mockResolvedValue(
    new TextEncoder().encode(
      JSON.stringify({
        captions: [],
        language: "en",
        model: "large-v3-turbo",
        annotation: null,
        generatedAt: CAPTIONS_GENERATED_AT,
      }),
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

  it("returns 409 for non-shorts jobs", async () => {
    getJobMock.mockResolvedValue(
      buildShortsJob("ready_for_review", { options: {} }),
    )

    const response = await POST(
      postRequest({ draft: validDraft() }),
      routeParams,
    )
    expect(response.status).toBe(409)
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

    const [jobId, manifest] = mergeJobArtifactsMock.mock.calls[0] as [
      string,
      Record<string, { kind: string; data: Record<string, unknown> }>,
    ]
    expect(jobId).toBe("job-1")
    expect(manifest.shorts.data).toMatchObject({
      domain: "shorts",
      phase: "ready_for_review",
      draftVersion: 4,
    })
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
