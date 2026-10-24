import { describe, expect, it, vi } from "vitest"

import { getSeoConfig } from "../config/seo"
import { startSeoRun, toAdminSeoObservation } from "./admin-seo-client"

const config = getSeoConfig({
  SEO_ADMIN_BASE_URL: "https://admin.example",
  SEO_ADMIN_ALLOWED_HOSTS: "admin.example",
  SEO_WORKLOAD_KEY_ID: "key-1",
  SEO_WORKLOAD_PRIVATE_KEY: "configured-by-test-seam",
})

describe("Admin SEO client", () => {
  it("minimizes provider observations before crossing the persistence boundary", () => {
    const projected = toAdminSeoObservation({
      id: "gsc-sensitive",
      provider: "gsc",
      status: "available",
      retrievedAt: "2026-08-01T00:00:00.000Z",
      scope: {},
      data: {
        rows: [{ query: "user@example.com token=secret", impressions: 10 }],
        headers: { authorization: "Bearer secret" },
      },
      quality: { complete: true, truncated: false, caveats: [] },
      sources: [{ url: "https://example.com/page?token=signed", title: null }],
    })
    const serialized = JSON.stringify(projected)
    expect(serialized).not.toContain("user@example.com")
    expect(serialized).not.toContain("Bearer secret")
    expect(serialized).not.toContain("?token=signed")
  })

  it("sends the strict start_run body and assertion on the ingest capability", async () => {
    let rawBody = ""
    const fetchImpl = vi.fn(async (_url, init) => {
      rawBody = String(init?.body)
      expect(new Headers(init?.headers).get("x-forge-seo-assertion")).toBe(
        "signed",
      )
      return Response.json({
        ok: true,
        result: {
          runId: "run-1",
          idempotencyKey: "daily-2026-08-01",
          mode: "DRY_RUN",
          status: "RUNNING",
          replayed: false,
          executionClaim: {
            generation: 1,
            token: "run-claim-token",
            expiresAt: "2026-08-01T00:15:00.000Z",
          },
          targets: [],
          lessons: [],
          coverage: {},
        },
      })
    }) as unknown as typeof fetch
    const sign = vi.fn(async () => "signed")
    const result = await startSeoRun(
      {
        action: "start_run",
        idempotencyKey: "daily-2026-08-01",
        mode: "dry_run",
        windowStart: "2026-07-01T00:00:00.000Z",
        windowEnd: "2026-08-01T00:00:00.000Z",
        targetLimit: 100,
      },
      {
        config,
        fetchImpl,
        sign,
        resolveHost: async () => [{ address: "93.184.216.34" }],
      },
    )
    expect(JSON.parse(rawBody)).toEqual({
      action: "start_run",
      idempotencyKey: "daily-2026-08-01",
      mode: "dry_run",
      windowStart: "2026-07-01T00:00:00.000Z",
      windowEnd: "2026-08-01T00:00:00.000Z",
      targetLimit: 100,
      leaseSeconds: 900,
    })
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({ capability: "ingest", rawBody }),
    )
    expect(result).toMatchObject({
      ok: true,
      result: { run: { id: "run-1", mode: "dry_run" }, targets: [] },
    })
  })

  it("fails closed before network access when signing configuration is absent", async () => {
    const fetchImpl = vi.fn()
    const result = await startSeoRun(
      { action: "start_run", idempotencyKey: "run", mode: "dry_run" },
      {
        config: getSeoConfig({
          SEO_ADMIN_BASE_URL: "https://admin.example",
          SEO_ADMIN_ALLOWED_HOSTS: "admin.example",
        }),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )
    expect(result).toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
