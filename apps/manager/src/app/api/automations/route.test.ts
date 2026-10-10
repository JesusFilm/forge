import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authenticateRequestMock,
  createAutomationMock,
  findMissingLanguageIdsMock,
  listAutomationsMock,
} = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
  createAutomationMock: vi.fn(),
  findMissingLanguageIdsMock: vi.fn(),
  listAutomationsMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/features/agents/automation-store", () => ({
  createAutomation: createAutomationMock,
  findMissingLanguageIds: findMissingLanguageIdsMock,
  listAutomations: listAutomationsMock,
}))

import { GET, POST } from "@/app/api/automations/route"

function buildCreateRequest(body: unknown) {
  return new Request("http://example.test/api/automations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("/api/automations", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    createAutomationMock.mockReset()
    findMissingLanguageIdsMock.mockReset()
    listAutomationsMock.mockReset()
    authenticateRequestMock.mockResolvedValue(null)
    findMissingLanguageIdsMock.mockResolvedValue([])
  })

  it("lists automations for authenticated Manager callers", async () => {
    listAutomationsMock.mockResolvedValue([{ documentId: "automation-1" }])

    const response = await GET(new Request("http://example.test"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      automations: [{ documentId: "automation-1" }],
    })
  })

  it("rejects target subtitle automations without target languages", async () => {
    const response = await POST(
      buildCreateRequest({
        name: "Missing subtitles",
        template: "target_subtitles_missing",
        refreshMode: "missing_only",
        schedule: { kind: "every_minute", timezone: "UTC" },
        targetLanguageIds: [],
        maxVideosPerRun: 1,
      }),
    )

    expect(response.status).toBe(400)
    expect(createAutomationMock).not.toHaveBeenCalled()
  })

  it("rejects target subtitle automations with more than one target language", async () => {
    const response = await POST(
      buildCreateRequest({
        name: "Missing subtitles",
        template: "target_subtitles_missing",
        refreshMode: "missing_only",
        schedule: { kind: "every_minute", timezone: "UTC" },
        targetLanguageIds: ["529", "6414"],
        maxVideosPerRun: 1,
      }),
    )

    expect(response.status).toBe(400)
    expect(createAutomationMock).not.toHaveBeenCalled()
  })

  it("rejects embedding automations until coverage-backed eligibility is available", async () => {
    const response = await POST(
      buildCreateRequest({
        name: "Missing transcript embeddings",
        template: "transcript_embeddings_missing",
        refreshMode: "missing_only",
        schedule: { kind: "every_minute", timezone: "UTC" },
        targetLanguageIds: [],
        maxVideosPerRun: 1,
      }),
    )

    expect(response.status).toBe(400)
    expect(createAutomationMock).not.toHaveBeenCalled()
  })

  it("creates active automations with a schedule summary and next run", async () => {
    createAutomationMock.mockResolvedValue({ documentId: "automation-1" })

    const response = await POST(
      buildCreateRequest({
        name: "Missing metadata",
        template: "metadata_missing",
        refreshMode: "missing_only",
        schedule: { kind: "daily", hour: 9, minute: 0, timezone: "UTC" },
        targetLanguageIds: [],
        maxVideosPerRun: 3,
      }),
    )

    expect(response.status).toBe(201)
    expect(createAutomationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Missing metadata",
        status: "active",
        scheduleSummary: "Daily at 9:00 AM",
        nextRunAt: expect.any(String),
      }),
    )
  })
})
