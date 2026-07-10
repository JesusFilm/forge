import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JobRecord } from "@/types/job"

const {
  authenticateOverrideMock,
  getJobMock,
  mergeJobArtifactsMock,
  artifactExistsMock,
  readArtifactMock,
  writeArtifactMock,
} = vi.hoisted(() => ({
  authenticateOverrideMock: vi.fn(),
  getJobMock: vi.fn(),
  mergeJobArtifactsMock: vi.fn(),
  artifactExistsMock: vi.fn(),
  readArtifactMock: vi.fn(),
  writeArtifactMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateManagerOverrideRequest: authenticateOverrideMock,
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
  writeArtifact: writeArtifactMock,
}))

const { POST } = await import("@/app/api/smart-crop/jobs/[id]/approve/route")
const { buildSmartCropAttemptsArtifact, buildSmartCropAttemptSummary } =
  await import("@/services/smartCrop")

const PLAN_ARTIFACT = {
  version: 1,
  kind: "smart-crop-canonical-plan",
  assetId: "asset123",
  muxAssetId: "mux-1",
  playbackId: "pb-1",
  source: { width: 1920, height: 1080, durationSeconds: 100 },
  target: { aspectRatio: "9:16", width: 1080, height: 1920 },
  strategy: {
    cropMode: "auto",
    plannerVersion: "smart-crop-planner-v1",
    model: "m",
  },
  segments: [
    {
      shotId: "shot_00001",
      canonicalStart: 0,
      canonicalEnd: 10,
      mode: "speaker",
      confidence: 0.9,
      cropKeyframes: [{ progress: 0, x: 0, y: 0, width: 606, height: 1080 }],
    },
  ],
  usage: { inputTokens: 0, outputTokens: 0 },
  qa: { status: "draft" },
  generatedAt: "2026-06-09T00:00:00.000Z",
}

function buildSmartCropJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "mux-1",
    muxPlaybackId: "pb-1",
    languages: [],
    options: {
      smartCrop: {
        kind: "canonical",
        assetId: "asset123",
        targetAspectRatio: "9:16",
        cropMode: "auto",
      },
    },
    status: "completed",
    retries: 0,
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
    ...overrides,
  }
}

function postRequest(body: unknown): Request {
  return new Request("http://example.test/api/smart-crop/jobs/job-1/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function buildAttemptsArtifact(status = "complete") {
  return buildSmartCropAttemptsArtifact({
    assetId: "asset123",
    selectedAttemptIndex: 1,
    attempts: [
      buildSmartCropAttemptSummary({
        attemptIndex: 1,
        status: status as Parameters<
          typeof buildSmartCropAttemptSummary
        >[0]["status"],
        source: "repair",
        repairedFromAttemptIndex: 0,
        createdAt: "2026-06-09T00:01:00.000Z",
        updatedAt: "2026-06-09T00:02:00.000Z",
        qa: { verdict: "pass", issueCount: 0, repairTriggerCount: 0 },
      }),
    ],
    updatedAt: "2026-06-09T00:02:00.000Z",
  })
}

const routeParams = { params: Promise.resolve({ id: "job-1" }) }

beforeEach(() => {
  authenticateOverrideMock.mockReset()
  getJobMock.mockReset()
  mergeJobArtifactsMock.mockReset()
  artifactExistsMock.mockReset()
  readArtifactMock.mockReset()
  writeArtifactMock.mockReset()

  // Session actor by default — the route records the authenticated identity.
  authenticateOverrideMock.mockResolvedValue({
    kind: "session",
    user: {
      id: "user-7",
      username: "Vlad",
      email: "vlad@example.test",
      role: { name: "Manager", type: "manager" },
    },
    approvedByUserId: "user-7",
  })
  getJobMock.mockResolvedValue(buildSmartCropJob())
  mergeJobArtifactsMock.mockResolvedValue(buildSmartCropJob())
  artifactExistsMock.mockImplementation(
    async (_assetId: string, artifactType: string) =>
      artifactType !== "smart-crop-attempts-9x16-v1",
  )
  readArtifactMock.mockResolvedValue(
    new TextEncoder().encode(JSON.stringify(PLAN_ARTIFACT)),
  )
  writeArtifactMock.mockResolvedValue("asset123/smart-crop-plan-9x16-v1.json")
})

describe("POST /api/smart-crop/jobs/[id]/approve", () => {
  it("returns 404 for unknown jobs", async () => {
    getJobMock.mockResolvedValue(null)

    const response = await POST(postRequest({ action: "approve" }), routeParams)
    expect(response.status).toBe(404)
  })

  it("returns 409 for non-smart-crop jobs", async () => {
    getJobMock.mockResolvedValue(buildSmartCropJob({ options: {} }))

    const response = await POST(postRequest({ action: "approve" }), routeParams)
    expect(response.status).toBe(409)
  })

  it("returns 409 for localized jobs", async () => {
    getJobMock.mockResolvedValue(
      buildSmartCropJob({
        options: {
          smartCrop: {
            kind: "localized",
            assetId: "asset456",
            targetAspectRatio: "9:16",
            cropMode: "auto",
            canonicalAssetId: "asset123",
            language: "uk",
          },
        },
      }),
    )

    const response = await POST(postRequest({ action: "approve" }), routeParams)
    expect(response.status).toBe(409)
  })

  it("returns 409 when the plan artifact does not exist yet", async () => {
    artifactExistsMock.mockResolvedValue(false)

    const response = await POST(postRequest({ action: "approve" }), routeParams)
    expect(response.status).toBe(409)
  })

  it("returns 400 for invalid actions", async () => {
    const response = await POST(postRequest({ action: "ship_it" }), routeParams)
    expect(response.status).toBe(400)
  })

  // Deliberately updated: approvedBy used to pin the hardcoded
  // "manager-operator" constant; the route now records the authenticated
  // actor (session email, or the api-key service id for bearer callers).
  it("approves the plan recording the session actor in the qa block", async () => {
    const response = await POST(postRequest({ action: "approve" }), routeParams)

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { ok: boolean; qa: unknown }
    expect(payload.ok).toBe(true)
    expect(payload.qa).toMatchObject({
      status: "approved",
      approvedBy: "vlad@example.test",
    })

    const writtenPlan = JSON.parse(
      String(writeArtifactMock.mock.calls[0]?.[0]?.body),
    ) as { qa: { status: string; approvedBy: string } }
    expect(writeArtifactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset123",
        artifactType: "smart-crop-plan-9x16-v1",
        ext: "json",
      }),
    )
    expect(writtenPlan.qa.status).toBe("approved")
    expect(writtenPlan.qa.approvedBy).toBe("vlad@example.test")

    expect(mergeJobArtifactsMock).toHaveBeenCalledWith("job-1", {
      smartCrop: {
        kind: "metadata",
        data: expect.objectContaining({
          domain: "smart_crop",
          kind: "canonical",
          plan: { segmentCount: 1, approved: true },
        }),
      },
    })
  })

  it("records the api-key service id for bearer-authenticated callers", async () => {
    authenticateOverrideMock.mockResolvedValue({
      kind: "api_key",
      approvedByUserId: "service:manager-api-key",
    })

    const response = await POST(postRequest({ action: "approve" }), routeParams)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      qa: { approvedBy: "service:manager-api-key" },
    })
  })

  it("approves the selected repaired attempt and copies it to the canonical plan", async () => {
    const attempts = buildAttemptsArtifact()
    artifactExistsMock.mockResolvedValue(true)
    readArtifactMock
      .mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify(attempts)))
      .mockResolvedValue(
        new TextEncoder().encode(JSON.stringify(PLAN_ARTIFACT)),
      )

    const response = await POST(
      postRequest({
        action: "approve",
        attemptIndex: 1,
        manifestDigest: attempts.manifestDigest,
      }),
      routeParams,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      attemptIndex: 1,
    })
    expect(writeArtifactMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        artifactType: "smart-crop-plan-9x16-attempt-001-v1",
      }),
    )
    expect(writeArtifactMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        artifactType: "smart-crop-plan-9x16-v1",
      }),
    )
    expect(writeArtifactMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        artifactType: "smart-crop-attempts-9x16-v1",
      }),
    )
  })

  it("requires an explicit selected attempt when an attempt manifest exists", async () => {
    const attempts = buildAttemptsArtifact()
    artifactExistsMock.mockResolvedValue(true)
    readArtifactMock.mockResolvedValueOnce(
      new TextEncoder().encode(JSON.stringify(attempts)),
    )

    const response = await POST(postRequest({ action: "approve" }), routeParams)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: "Smart Crop attempt selection is required; refresh and try again",
    })
    expect(writeArtifactMock).not.toHaveBeenCalled()
  })

  it("rejects selected attempts that are not ready for review", async () => {
    const attempts = buildAttemptsArtifact("planned")
    artifactExistsMock.mockResolvedValue(true)
    readArtifactMock.mockResolvedValueOnce(
      new TextEncoder().encode(JSON.stringify(attempts)),
    )

    const response = await POST(
      postRequest({
        action: "approve",
        attemptIndex: 1,
        manifestDigest: attempts.manifestDigest,
      }),
      routeParams,
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: "Selected Smart Crop attempt is not ready for review",
    })
    expect(writeArtifactMock).not.toHaveBeenCalled()
  })

  it("propagates the authenticator's error response", async () => {
    const { NextResponse } = await import("next/server")
    authenticateOverrideMock.mockResolvedValue(
      NextResponse.json(
        { error: "Interactive Manager session or API key required" },
        { status: 403 },
      ),
    )

    const response = await POST(postRequest({ action: "approve" }), routeParams)
    expect(response.status).toBe(403)
    expect(writeArtifactMock).not.toHaveBeenCalled()
  })

  it("rejects the plan with qa.status rejected", async () => {
    const response = await POST(postRequest({ action: "reject" }), routeParams)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      qa: { status: "rejected" },
    })
    expect(mergeJobArtifactsMock).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        smartCrop: expect.objectContaining({
          data: expect.objectContaining({
            plan: { segmentCount: 1, approved: false },
          }),
        }),
      }),
    )
  })
})
