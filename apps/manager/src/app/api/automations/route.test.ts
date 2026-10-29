import { RemovedCmsClientError } from "@/cms/client"
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
  it("returns JSON when language validation cannot reach the backend", async () => {
    findMissingLanguageIdsMock.mockRejectedValue(
      new Error("backend unavailable"),
    )
    const response = await POST(
      buildCreateRequest({
        name: "Missing subtitles",
        template: "target_subtitles_missing",
        refreshMode: "missing_only",
        schedule: { kind: "every_minute", timezone: "UTC" },
        targetLanguageIds: ["529"],
        maxVideosPerRun: 1,
      }),
    )
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: "Failed to create automation",
    })
    expect(createAutomationMock).not.toHaveBeenCalled()
  })

  it.each(["GET", "POST"])(
    "returns JSON when %s authentication throws",
    async (method) => {
      authenticateRequestMock.mockRejectedValue(
        new Error("session service unavailable"),
      )
      const response =
        method === "GET"
          ? await GET(new Request("http://example.test/api/automations"))
          : await POST(buildCreateRequest({}))
      expect(response.status).toBe(502)
      expect(response.headers.get("content-type")).toContain("application/json")
      await expect(response.json()).resolves.toHaveProperty("error")
      expect(createAutomationMock).not.toHaveBeenCalled()
      expect(listAutomationsMock).not.toHaveBeenCalled()
    },
  )

  it("preserves authentication denials", async () => {
    authenticateRequestMock.mockResolvedValue(
      Response.json({ error: "Authentication required" }, { status: 401 }),
    )
    const response = await POST(buildCreateRequest({}))
    expect(response.status).toBe(401)
    expect(findMissingLanguageIdsMock).not.toHaveBeenCalled()
  })

  it("reports the missing backend explicitly for source-subtitle creation", async () => {
    createAutomationMock.mockRejectedValue(new RemovedCmsClientError())
    const response = await POST(
      buildCreateRequest({
        name: "Missing source subtitles",
        template: "source_subtitles_missing",
        runMode: "dry_run",
        refreshMode: "missing_only",
        schedule: {
          kind: "weekly",
          weekday: "mon",
          hour: 9,
          minute: 0,
          timezone: "UTC",
        },
        targetLanguageIds: [],
        maxVideosPerRun: 6,
      }),
    )
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error:
        "Automations are currently unavailable. Use Report to start enrichment jobs manually.",
    })
  })

  it("reports the missing backend when listing automations", async () => {
    listAutomationsMock.mockRejectedValue(new RemovedCmsClientError())
    const response = await GET(
      new Request("http://example.test/api/automations"),
    )
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toHaveProperty(
      "error",
      "Automations are currently unavailable. Use Report to start enrichment jobs manually.",
    )
  })
})
