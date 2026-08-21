import { describe, expect, it, vi } from "vitest"
import { ConsumerLifecycleIngestionService } from "./consumer-lifecycle-ingestion.service"
import type { ConsumerLifecycleService } from "./consumer-lifecycle.service"

describe("ConsumerLifecycleIngestionService", () => {
  it("uses the lifecycle-only authorization seam before projection", async () => {
    const apply = vi.fn().mockResolvedValue({
      applied: true,
      replayed: false,
      stale: false,
    })
    const assertLifecycleAuthorized = vi.fn()
    const service = new ConsumerLifecycleIngestionService(
      { apply } as unknown as ConsumerLifecycleService,
      { assertLifecycleAuthorized },
    )
    const event = {
      ownerSubject: "consumer-1",
      state: "DISABLED" as const,
      version: 2n,
      sourceEventId: "event-2",
      activeLeaseExpiresAt: null,
    }

    await expect(
      service.ingest(event, "lifecycle-credential"),
    ).resolves.toEqual({ applied: true, replayed: false, stale: false })
    expect(assertLifecycleAuthorized).toHaveBeenCalledWith(
      "lifecycle-credential",
    )
    expect(apply).toHaveBeenCalledWith(event)
  })
})
