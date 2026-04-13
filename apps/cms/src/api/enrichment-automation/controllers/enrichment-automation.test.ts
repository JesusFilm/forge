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

describe("enrichment-automation controller", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("atomically claims an active automation lease for manual dry-runs", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-12T09:00:00.000Z"))

    const rawMock = vi.fn().mockResolvedValue({
      rows: [{ document_id: "automation-1" }],
    })
    const strapi = {
      db: { connection: { raw: rawMock } },
      log: { error: vi.fn() },
    }

    const controllerModule = await import("./enrichment-automation")
    const controller = controllerModule.default({
      strapi: strapi as never,
    })

    const ctx: TestContext = {
      status: 0,
      body: null,
      params: { documentId: "automation-1" },
      request: {},
    }

    await controller.manualDryRunClaim(ctx)

    expect(rawMock).toHaveBeenCalledWith(
      expect.stringContaining("FOR UPDATE SKIP LOCKED"),
      [
        "automation-1",
        "2026-04-12T09:00:00.000Z",
        expect.any(String),
        "2026-04-12T09:10:00.000Z",
        "2026-04-12T09:00:00.000Z",
      ],
    )
    expect(ctx.status).toBe(200)
    expect(ctx.body).toEqual({
      documentId: "automation-1",
      leaseToken: expect.any(String),
      leaseExpiresAt: "2026-04-12T09:10:00.000Z",
    })
  })

  it("returns a conflict when the manual dry-run lease cannot be claimed", async () => {
    const rawMock = vi.fn().mockResolvedValue({ rows: [] })
    const strapi = {
      db: { connection: { raw: rawMock } },
      log: { error: vi.fn() },
    }

    const controllerModule = await import("./enrichment-automation")
    const controller = controllerModule.default({
      strapi: strapi as never,
    })

    const ctx: TestContext = {
      status: 0,
      body: null,
      params: { documentId: "automation-1" },
      request: {},
    }

    await controller.manualDryRunClaim(ctx)

    expect(ctx.status).toBe(409)
    expect(ctx.body).toEqual({
      error: "Automation already has an active lease.",
    })
  })

  it("releases only the matching manual dry-run lease token", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-12T09:05:00.000Z"))

    const rawMock = vi.fn().mockResolvedValue({
      rows: [{ document_id: "automation-1" }],
    })
    const strapi = {
      db: { connection: { raw: rawMock } },
      log: { error: vi.fn() },
    }

    const controllerModule = await import("./enrichment-automation")
    const controller = controllerModule.default({
      strapi: strapi as never,
    })

    const ctx: TestContext = {
      status: 0,
      body: null,
      params: { documentId: "automation-1" },
      request: { body: { leaseToken: "lease-1" } },
    }

    await controller.manualDryRunRelease(ctx)

    expect(rawMock).toHaveBeenCalledWith(
      expect.stringContaining("lease_token"),
      ["2026-04-12T09:05:00.000Z", "automation-1", "lease-1"],
    )
    expect(ctx.status).toBe(200)
    expect(ctx.body).toEqual({ released: true })
  })
})
