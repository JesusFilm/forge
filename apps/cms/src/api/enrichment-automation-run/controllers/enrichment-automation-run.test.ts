import { afterEach, describe, expect, it, vi } from "vitest"

type TestContext = {
  status: number
  body: unknown
  params: {
    documentId?: string
  }
  request: {
    body?: Record<string, unknown>
  }
}

describe("enrichment-automation-run controller", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("marks a run failed only when it is still claimed or running", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-12T09:05:00.000Z"))

    const rawMock = vi.fn().mockResolvedValue({
      rows: [{ document_id: "run-1" }],
    })
    const strapi = {
      db: { connection: { raw: rawMock } },
      log: { error: vi.fn() },
    }

    const controllerModule = await import("./enrichment-automation-run")
    const controller = controllerModule.default({
      strapi: strapi as never,
    })

    const ctx: TestContext = {
      status: 0,
      body: null,
      params: { documentId: "run-1" },
      request: {
        body: {
          error: "database timeout",
          finishedAt: "2026-04-12T09:04:00.000Z",
        },
      },
    }

    await controller.markFailedIfInFlight(ctx)

    expect(rawMock).toHaveBeenCalledWith(
      expect.stringContaining("status IN ('claimed', 'running')"),
      [
        "2026-04-12T09:04:00.000Z",
        "[]",
        JSON.stringify(["database timeout"]),
        "Automation dry run failed.",
        "2026-04-12T09:05:00.000Z",
        "run-1",
      ],
    )
    expect(ctx.status).toBe(200)
    expect(ctx.body).toEqual({ updated: true })
  })

  it("does not update terminal runs", async () => {
    const rawMock = vi.fn().mockResolvedValue({ rows: [] })
    const strapi = {
      db: { connection: { raw: rawMock } },
      log: { error: vi.fn() },
    }

    const controllerModule = await import("./enrichment-automation-run")
    const controller = controllerModule.default({
      strapi: strapi as never,
    })

    const ctx: TestContext = {
      status: 0,
      body: null,
      params: { documentId: "run-1" },
      request: {
        body: {
          error: "database timeout",
          finishedAt: "2026-04-12T09:04:00.000Z",
        },
      },
    }

    await controller.markFailedIfInFlight(ctx)

    expect(ctx.status).toBe(200)
    expect(ctx.body).toEqual({ updated: false })
  })
})
