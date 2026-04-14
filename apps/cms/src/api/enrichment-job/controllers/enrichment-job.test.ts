import { describe, expect, it, vi } from "vitest"

type TestContext = {
  status: number
  body: unknown
  request: {
    body?: Record<string, unknown>
  }
}

describe("enrichment-job controller", () => {
  it("returns only running automation keys for automation duplicate suppression", async () => {
    const rawMock = vi.fn().mockResolvedValue({
      rows: [
        { automation_key: "metadata_missing:video-1:source" },
        { automation_key: "metadata_missing:video-2:source" },
        { automation_key: null },
      ],
    })
    const strapi = {
      documents: vi.fn(),
      db: { connection: { raw: rawMock } },
      log: { error: vi.fn() },
    }

    const controllerModule = await import("./enrichment-job")
    const controller = controllerModule.default({
      strapi: strapi as never,
    })

    const ctx: TestContext = {
      status: 0,
      body: null,
      request: {},
    }

    await controller.runningAutomationKeys(ctx)

    const [sql] = rawMock.mock.calls[0] ?? []
    expect(sql).toContain("automation_key")
    expect(sql).toContain("pending")
    expect(sql).not.toContain("artifacts #>>")
    expect(ctx.status).toBe(200)
    expect(ctx.body).toEqual({
      automationKeys: [
        "metadata_missing:video-1:source",
        "metadata_missing:video-2:source",
      ],
    })
  })

  it("creates an enrichment job by resolving the video document relation in CMS", async () => {
    const createMock = vi.fn().mockResolvedValue({ documentId: "job-doc-1" })
    const strapi = {
      documents: vi.fn().mockReturnValue({
        create: createMock,
      }),
      db: {
        connection: {
          raw: vi.fn().mockResolvedValue({
            rows: [
              {
                id: 1715,
                document_id: "video-doc-1",
                published_at: "2026-04-11T00:00:00.000Z",
              },
            ],
          }),
        },
      },
      log: {
        error: vi.fn(),
      },
    }

    const controllerModule = await import("./enrichment-job")
    const controller = controllerModule.default({
      strapi: strapi as never,
    })

    const ctx: TestContext = {
      status: 0,
      body: null,
      request: {
        body: {
          muxAssetId: "asset-1",
          muxPlaybackId: "playback-1",
          languages: ["529"],
          status: "pending",
          retries: 0,
          artifacts: {
            automation: {
              kind: "metadata",
              data: {
                automationKey: "metadata_missing:video-doc-1:source",
              },
            },
          },
          errors: [],
          steps: [],
          videoDocumentId: "video-doc-1",
        },
      },
    }

    await controller.internalCreate(ctx)

    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        muxAssetId: "asset-1",
        muxPlaybackId: "playback-1",
        video: 1715,
        automationKey: "metadata_missing:video-doc-1:source",
      }),
    })
    expect(ctx.status).toBe(200)
    expect(ctx.body).toEqual({ documentId: "job-doc-1" })
  })

  it("falls back to the first row when the video only has a draft row", async () => {
    const createMock = vi.fn().mockResolvedValue({ documentId: "job-doc-2" })
    const strapi = {
      documents: vi.fn().mockReturnValue({
        create: createMock,
      }),
      db: {
        connection: {
          raw: vi.fn().mockResolvedValue({
            rows: [
              {
                id: 1215,
                document_id: "video-doc-1",
                published_at: null,
              },
            ],
          }),
        },
      },
      log: {
        error: vi.fn(),
      },
    }

    const controllerModule = await import("./enrichment-job")
    const controller = controllerModule.default({
      strapi: strapi as never,
    })

    const ctx: TestContext = {
      status: 0,
      body: null,
      request: {
        body: {
          muxAssetId: "asset-1",
          muxPlaybackId: "playback-1",
          languages: ["529"],
          status: "pending",
          retries: 0,
          artifacts: {},
          errors: [],
          steps: [],
          videoDocumentId: "video-doc-1",
        },
      },
    }

    await controller.internalCreate(ctx)

    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        video: 1215,
      }),
    })
    expect(ctx.status).toBe(200)
    expect(ctx.body).toEqual({ documentId: "job-doc-2" })
  })

  it("returns 404 when the video document cannot be resolved", async () => {
    const createMock = vi.fn()
    const strapi = {
      documents: vi.fn().mockReturnValue({
        create: createMock,
      }),
      db: {
        connection: {
          raw: vi.fn().mockResolvedValue({
            rows: [],
          }),
        },
      },
      log: {
        error: vi.fn(),
      },
    }

    const controllerModule = await import("./enrichment-job")
    const controller = controllerModule.default({
      strapi: strapi as never,
    })

    const ctx: TestContext = {
      status: 0,
      body: null,
      request: {
        body: {
          muxAssetId: "asset-1",
          muxPlaybackId: "playback-1",
          languages: ["529"],
          status: "pending",
          retries: 0,
          artifacts: {},
          errors: [],
          steps: [],
          videoDocumentId: "missing-video-doc",
        },
      },
    }

    await controller.internalCreate(ctx)

    expect(createMock).not.toHaveBeenCalled()
    expect(ctx.status).toBe(404)
    expect(ctx.body).toEqual({ error: "Video not found" })
  })
})
