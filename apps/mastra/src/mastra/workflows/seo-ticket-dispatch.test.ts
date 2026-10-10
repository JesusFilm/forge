import { describe, expect, it, vi } from "vitest"

import { getSeoConfig } from "../../config/seo"
import {
  runSeoTicketDispatch,
  seoTicketDispatchWorkflow,
} from "./seo-ticket-dispatch"

const claimedEntry = {
  outboxId: "outbox-1",
  generation: 3,
  leaseToken: "lease-1",
  leaseExpiresAt: "2026-08-01T12:03:00.000Z",
  payloadDigest: "a".repeat(64),
  marker: "forge-seo:proposal-1:v1:aaaaaaaaaaaa",
  remoteId: null,
  remoteUrl: null,
  payload: {
    title: "Fix canonical contract",
    description: "Approved immutable brief",
    acceptanceCriteria: ["Preserve locale identity"],
    affectedScope: ["watch"],
  },
}

describe("SEO ticket dispatch workflow", () => {
  it("reconciles before create and completes using the current fence", async () => {
    const update = vi.fn(async () => ({ ok: true, result: {} }))
    const reconcile = vi.fn(async () => ({ ok: true, status: "not_found" }))
    const create = vi.fn(async () => ({
      ok: true,
      ticket: {
        id: "FGE-123",
        url: "https://linear.app/team/issue/FGE-123",
        title: "Fix canonical contract",
        description: "Approved immutable brief",
        team: { id: "team-1" },
      },
    }))
    const result = await runSeoTicketDispatch(
      { scheduledFor: "2026-08-01T12:00:00.000Z" },
      {
        config: getSeoConfig({ SEO_AUTOMATION_MODE: "live" }),
        claim: vi.fn(async () => ({
          ok: true,
          result: { entries: [claimedEntry] },
        })) as never,
        reconcile: reconcile as never,
        create: create as never,
        update: update as never,
      },
    )
    expect(result).toMatchObject({ ok: true, claimed: 1, completed: 1 })
    expect(reconcile).toHaveBeenCalledBefore(create)
    expect(update).toHaveBeenCalledWith({
      action: "complete",
      outboxId: "outbox-1",
      generation: 3,
      leaseToken: "lease-1",
      remoteId: "FGE-123",
      remoteUrl: "https://linear.app/team/issue/FGE-123",
    })
  })

  it("fences ambiguous reconciliation into manual review without creating", async () => {
    const create = vi.fn()
    const update = vi.fn(async () => ({ ok: true, result: {} }))
    const result = await runSeoTicketDispatch(
      { scheduledFor: "2026-08-01T12:00:00.000Z" },
      {
        config: getSeoConfig({ SEO_AUTOMATION_MODE: "live" }),
        claim: vi.fn(async () => ({
          ok: true,
          result: { entries: [claimedEntry] },
        })) as never,
        reconcile: vi.fn(async () => ({
          ok: false,
          reason: "ambiguous",
          retryable: false,
          ambiguous: true,
          candidates: [
            {
              id: "FGE-124",
              url: "https://linear.app/team/issue/FGE-124",
              title: "Exact candidate",
              description: "",
              team: { id: "team-1" },
            },
          ],
        })) as never,
        create: create as never,
        update: update as never,
      },
    )
    expect(result.manualReconcile).toBe(1)
    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "manual_reconcile",
        outboxId: "outbox-1",
        generation: 3,
        leaseToken: "lease-1",
        candidates: [expect.objectContaining({ id: "FGE-124" })],
      }),
    )
  })

  it("retains candidates from an ambiguous post-create reconciliation", async () => {
    const update = vi.fn(async () => ({ ok: true, result: {} }))
    const reconcile = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: "not_found" })
      .mockResolvedValueOnce({
        ok: false,
        reason: "ambiguous",
        retryable: false,
        ambiguous: true,
        candidates: [
          {
            id: "FGE-125",
            url: "https://linear.app/team/issue/FGE-125",
            title: "Exact candidate",
            description: "",
            team: { id: "team-1" },
          },
        ],
      })
    await runSeoTicketDispatch(
      { scheduledFor: "2026-08-01T12:00:00.000Z" },
      {
        config: getSeoConfig({ SEO_AUTOMATION_MODE: "live" }),
        claim: vi.fn(async () => ({
          ok: true,
          result: { entries: [claimedEntry] },
        })) as never,
        reconcile: reconcile as never,
        create: vi.fn(async () => ({
          ok: false,
          reason: "timeout",
          retryable: false,
          ambiguous: true,
        })) as never,
        update: update as never,
      },
    )

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "manual_reconcile",
        candidates: [expect.objectContaining({ id: "FGE-125" })],
      }),
    )
  })

  it("is registered for the ten-minute UTC sweep", () => {
    const schedules = (
      seoTicketDispatchWorkflow as typeof seoTicketDispatchWorkflow & {
        getScheduleConfigs: () => Array<{ cron: string; timezone?: string }>
      }
    ).getScheduleConfigs()
    expect(schedules).toEqual([
      expect.objectContaining({ cron: "*/10 * * * *", timezone: "UTC" }),
    ])
  })
})
