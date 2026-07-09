import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JobRecord } from "@/types/job"

const {
  authenticateManagerOverrideRequestMock,
  authenticateRequestMock,
  createJobMock,
  listJobsMock,
  updateJobMock,
  getMuxAssetPlaybackMock,
  lookupVideosMock,
  launchShortsMock,
} = vi.hoisted(() => ({
  authenticateManagerOverrideRequestMock: vi.fn(),
  authenticateRequestMock: vi.fn(),
  createJobMock: vi.fn(),
  listJobsMock: vi.fn(),
  updateJobMock: vi.fn(),
  getMuxAssetPlaybackMock: vi.fn(),
  lookupVideosMock: vi.fn(),
  launchShortsMock: vi.fn(),
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
  createJob: createJobMock,
  listJobs: listJobsMock,
  updateJob: updateJobMock,
}))

vi.mock("@/services/mux", () => ({
  getMuxAssetPlayback: getMuxAssetPlaybackMock,
}))

vi.mock("@/lib/admin-video-lookup", () => ({
  lookupVideosByCoreIdFromAdmin: lookupVideosMock,
}))

vi.mock("@/workflows/launchShorts", () => ({
  launchShorts: launchShortsMock,
}))

vi.mock("@/config/env", () => ({
  env: {} as Record<string, string | undefined>,
}))

const { env } = await import("@/config/env")
const { GET, POST } = await import("@/app/api/shorts/jobs/route")

const envMutable = env as unknown as Record<string, string | undefined>

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

function buildJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "mux-1",
    muxPlaybackId: "pbpublic",
    languages: [],
    options: {},
    status: "pending",
    retries: 0,
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
    ...overrides,
  }
}

function adminVideo(overrides: Record<string, unknown> = {}) {
  return {
    id: "video-1",
    coreId: "1_jf-0-0",
    label: "JESUS",
    primaryLanguageBcp47: "pt-BR",
    muxAssetId: "mux-1",
    subtitleUrl: null,
    ...overrides,
  }
}

function postRequest(body: unknown): Request {
  return new Request("http://example.test/api/shorts/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const validClip = { startSec: 10, endSec: 40 }

beforeEach(() => {
  authenticateManagerOverrideRequestMock.mockReset()
  authenticateRequestMock.mockReset()
  createJobMock.mockReset()
  listJobsMock.mockReset()
  updateJobMock.mockReset()
  getMuxAssetPlaybackMock.mockReset()
  lookupVideosMock.mockReset()
  launchShortsMock.mockReset()

  authenticateManagerOverrideRequestMock.mockResolvedValue(sessionActor)
  authenticateRequestMock.mockResolvedValue(null)
  createJobMock.mockResolvedValue(buildJob())
  listJobsMock.mockResolvedValue([])
  updateJobMock.mockResolvedValue(null)
  getMuxAssetPlaybackMock.mockResolvedValue({
    assetId: "mux-1",
    status: "ready",
    duration: 120,
    publicPlaybackId: "pbpublic",
  })
  lookupVideosMock.mockResolvedValue({
    ok: true,
    data: new Map([["1_jf-0-0", adminVideo()]]),
  })
  launchShortsMock.mockResolvedValue(undefined)

  envMutable.SHORTS_WORKER_BASE_URL = "https://shorts-worker.internal"
  envMutable.SHORTS_WORKER_API_KEY = "shorts-key"
})

describe("POST /api/shorts/jobs", () => {
  it("rejects unauthorized callers", async () => {
    const { NextResponse } = await import("next/server")
    authenticateManagerOverrideRequestMock.mockResolvedValue(
      NextResponse.json({ error: "auth required" }, { status: 403 }),
    )

    const response = await POST(
      postRequest({ muxAssetId: "mux-1", clip: validClip }),
    )
    expect(response.status).toBe(403)
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it("returns 400 for invalid JSON bodies", async () => {
    const response = await POST(
      new Request("http://example.test/api/shorts/jobs", {
        method: "POST",
        body: "{not json",
      }),
    )
    expect(response.status).toBe(400)
  })

  it("requires at least one of coreId/muxAssetId", async () => {
    const response = await POST(postRequest({ clip: validClip }))
    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error: string }
    expect(payload.error).toBe("Validation failed")
  })

  it("rejects ids that fail the storage pattern", async () => {
    const response = await POST(
      postRequest({ muxAssetId: "mux/../evil", clip: validClip }),
    )
    expect(response.status).toBe(400)

    const coreIdResponse = await POST(
      postRequest({ coreId: "core id with spaces", clip: validClip }),
    )
    expect(coreIdResponse.status).toBe(400)
    expect(lookupVideosMock).not.toHaveBeenCalled()
  })

  it("returns 503 config_missing when shorts-worker env is unset", async () => {
    envMutable.SHORTS_WORKER_BASE_URL = undefined

    const response = await POST(
      postRequest({ muxAssetId: "mux-1", clip: validClip }),
    )
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      reason: "config_missing",
      retryable: false,
    })
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it("returns 404 video_not_found for an unknown coreId", async () => {
    lookupVideosMock.mockResolvedValue({ ok: true, data: new Map() })

    const response = await POST(
      postRequest({
        coreId: "1_jf-0-0",
        sourceSlug: "jesus-film",
        clip: validClip,
      }),
    )
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      reason: "video_not_found",
    })
  })

  it("returns 422 missing_mux_asset when the admin video has no Mux asset", async () => {
    lookupVideosMock.mockResolvedValue({
      ok: true,
      data: new Map([["1_jf-0-0", adminVideo({ muxAssetId: null })]]),
    })

    const response = await POST(
      postRequest({ coreId: "1_jf-0-0", clip: validClip }),
    )
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      reason: "missing_mux_asset",
    })
  })

  it("maps admin lookup config_missing to 503 and transport failures to 502", async () => {
    lookupVideosMock.mockResolvedValue({
      ok: false,
      reason: "config_missing",
      messages: ["ADMIN_GRAPHQL_URL unset"],
      retryable: false,
    })
    const misconfigured = await POST(
      postRequest({ coreId: "1_jf-0-0", clip: validClip }),
    )
    expect(misconfigured.status).toBe(503)

    lookupVideosMock.mockResolvedValue({
      ok: false,
      reason: "network_error",
      messages: ["timeout"],
      retryable: true,
    })
    const unreachable = await POST(
      postRequest({ coreId: "1_jf-0-0", clip: validClip }),
    )
    expect(unreachable.status).toBe(502)
    await expect(unreachable.json()).resolves.toMatchObject({
      reason: "admin_unreachable",
      upstreamReason: "network_error",
    })
  })

  it("returns 422 playback_not_public when the asset is signed/drm only", async () => {
    getMuxAssetPlaybackMock.mockResolvedValue({
      assetId: "mux-1",
      status: "ready",
      duration: 120,
      publicPlaybackId: null,
    })

    const response = await POST(
      postRequest({ muxAssetId: "mux-1", clip: validClip }),
    )
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      reason: "playback_not_public",
      retryable: false,
    })
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it("validates clip bounds with typed reasons", async () => {
    const tooShort = await POST(
      postRequest({ muxAssetId: "mux-1", clip: { startSec: 10, endSec: 14 } }),
    )
    expect(tooShort.status).toBe(422)
    await expect(tooShort.json()).resolves.toMatchObject({
      reason: "clip_too_short",
    })

    const inverted = await POST(
      postRequest({ muxAssetId: "mux-1", clip: { startSec: 40, endSec: 20 } }),
    )
    expect(inverted.status).toBe(422)
    await expect(inverted.json()).resolves.toMatchObject({
      reason: "clip_too_short",
    })

    const tooLong = await POST(
      postRequest({ muxAssetId: "mux-1", clip: { startSec: 0, endSec: 200 } }),
    )
    expect(tooLong.status).toBe(422)
    await expect(tooLong.json()).resolves.toMatchObject({
      reason: "clip_too_long",
    })

    const outOfBounds = await POST(
      postRequest({
        muxAssetId: "mux-1",
        clip: { startSec: 100, endSec: 121 },
      }),
    )
    expect(outOfBounds.status).toBe(422)
    await expect(outOfBounds.json()).resolves.toMatchObject({
      reason: "clip_out_of_bounds",
    })

    expect(createJobMock).not.toHaveBeenCalled()
  })

  it("tolerates a clip end within 0.5s past the live duration", async () => {
    const response = await POST(
      postRequest({
        muxAssetId: "mux-1",
        clip: { startSec: 90, endSec: 120.4 },
      }),
    )
    expect(response.status).toBe(201)
  })

  it("skips the duration bound when Mux reports a null duration", async () => {
    getMuxAssetPlaybackMock.mockResolvedValue({
      assetId: "mux-1",
      status: "ready",
      duration: null,
      publicPlaybackId: "pbpublic",
    })

    const response = await POST(
      postRequest({
        muxAssetId: "mux-1",
        clip: { startSec: 500, endSec: 560 },
      }),
    )
    expect(response.status).toBe(201)
  })

  it("creates a coreId job with resolved language, title, and minted assetId", async () => {
    const response = await POST(
      postRequest({
        coreId: "1_jf-0-0",
        sourceSlug: "jesus-film",
        clip: validClip,
      }),
    )
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      job: { id: "job-1" },
    })

    expect(createJobMock).toHaveBeenCalledWith(
      "mux-1",
      "pbpublic",
      [],
      expect.objectContaining({
        sourceMediaTitle: "JESUS",
        jobOptions: {
          shorts: expect.objectContaining({
            assetId: expect.stringMatching(/^mux-1-short-[0-9a-f]{8}$/),
            sourceMuxAssetId: "mux-1",
            sourcePlaybackId: "pbpublic",
            sourceCoreId: "1_jf-0-0",
            sourceSlug: "jesus-film",
            sourceTitle: "JESUS",
            clip: { startSec: 10, endSec: 40 },
            language: { bcp47: "pt-BR", whisper: "pt" },
            requestedBy: "op@jesusfilm.org",
          }),
        },
        steps: [expect.objectContaining({ name: "shorts_prepare" })],
        initialArtifacts: {
          shorts: expect.objectContaining({
            kind: "metadata",
            data: expect.objectContaining({
              domain: "shorts",
              phase: "queued",
              draftVersion: 0,
            }),
          }),
        },
      }),
    )
    expect(launchShortsMock).toHaveBeenCalledWith("prepare", "job-1")
  })

  it("ignores body-supplied audit fields — requestedBy comes from the actor", async () => {
    const response = await POST(
      postRequest({
        muxAssetId: "mux-1",
        clip: validClip,
        requestedBy: "attacker@example.test",
      }),
    )
    expect(response.status).toBe(201)
    const options = createJobMock.mock.calls[0]?.[3] as {
      jobOptions: { shorts: { requestedBy: string } }
    }
    expect(options.jobOptions.shorts.requestedBy).toBe("op@jesusfilm.org")
  })

  it("creates a muxAssetId-only job with null language (whisper degrades)", async () => {
    const response = await POST(
      postRequest({ muxAssetId: "mux-1", clip: validClip, title: "My short" }),
    )
    expect(response.status).toBe(201)
    expect(lookupVideosMock).not.toHaveBeenCalled()

    const options = createJobMock.mock.calls[0]?.[3] as {
      jobOptions: {
        shorts: {
          language: { bcp47: string | null; whisper: string | null }
          sourceTitle?: string
          sourceCoreId?: string
        }
      }
    }
    expect(options.jobOptions.shorts.language).toEqual({
      bcp47: null,
      whisper: null,
    })
    expect(options.jobOptions.shorts.sourceTitle).toBe("My short")
    expect(options.jobOptions.shorts.sourceCoreId).toBeUndefined()
  })

  it("rejects a muxAssetId that contradicts the coreId's video", async () => {
    const response = await POST(
      postRequest({
        coreId: "1_jf-0-0",
        muxAssetId: "mux-other",
        clip: validClip,
      }),
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      reason: "asset_mismatch",
      retryable: false,
    })
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it("returns 502 mux_error when the Mux lookup fails", async () => {
    getMuxAssetPlaybackMock.mockRejectedValue(new Error("mux 503"))

    const response = await POST(
      postRequest({ muxAssetId: "mux-1", clip: validClip }),
    )
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      reason: "mux_error",
      retryable: true,
    })
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it("marks the job failed and returns the retry pointer when the launch throws", async () => {
    launchShortsMock.mockRejectedValue(new Error("workflow runtime down"))

    const response = await POST(
      postRequest({ muxAssetId: "mux-1", clip: validClip }),
    )
    expect(response.status).toBe(500)
    expect(updateJobMock).toHaveBeenCalledWith("job-1", { status: "failed" })
    // retryable:false — callers recover via the retry route on the returned
    // jobId, not by re-POSTing this route (which would duplicate the job).
    await expect(response.json()).resolves.toMatchObject({
      reason: "launch_failed",
      retryable: false,
      jobId: "job-1",
    })
  })

  it("fails the job even when the launch throws synchronously", async () => {
    launchShortsMock.mockImplementation(() => {
      throw new Error("sync boom")
    })

    const response = await POST(
      postRequest({ muxAssetId: "mux-1", clip: validClip }),
    )
    expect(response.status).toBe(500)
    expect(updateJobMock).toHaveBeenCalledWith("job-1", { status: "failed" })
  })
})

describe("GET /api/shorts/jobs", () => {
  it("rejects unauthorized callers", async () => {
    authenticateRequestMock.mockResolvedValue(
      Response.json({ error: "Authentication required" }, { status: 401 }),
    )

    const response = await GET(
      new Request("http://example.test/api/shorts/jobs"),
    )
    expect(response.status).toBe(401)
  })

  it("filters to jobs with options.shorts", async () => {
    listJobsMock.mockResolvedValue([
      buildJob({ id: "enrichment-job" }),
      buildJob({
        id: "shorts-job",
        options: {
          shorts: {
            assetId: "mux-1-short-abcd1234",
            sourceMuxAssetId: "mux-1",
            sourcePlaybackId: "pbpublic",
            clip: { startSec: 10, endSec: 40 },
            language: { bcp47: "en", whisper: "en" },
          },
        },
      }),
    ])

    const response = await GET(
      new Request("http://example.test/api/shorts/jobs"),
    )
    expect(response.status).toBe(200)
    const payload = (await response.json()) as { jobs: JobRecord[] }
    expect(payload.jobs.map((job) => job.id)).toEqual(["shorts-job"])
    // Documented cross-kind cap: the limit applies across ALL job kinds
    // before the shorts filter, so it stays well above the shorts volume.
    expect(listJobsMock).toHaveBeenCalledWith({ limit: 250 })
  })
})
