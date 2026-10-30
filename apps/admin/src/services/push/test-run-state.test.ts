/**
 * KTD14 and KTD17 — the test-run read that the dashboard refusal and the agent
 * path share. The test may import the workflow module; the production module
 * may not, so the two window constants are pinned equal here.
 */
import { describe, expect, it, vi } from "vitest"

import { PUSH_FINAL_RECONCILE_DELAY_MS } from "@/workflows/pushCampaign"

import {
  formatPushTestRunRefusal,
  PUSH_TEST_RECEIPT_WINDOW_MS,
  readPushTestRunState,
} from "./test-run-state"

const CAMPAIGN_ID = "campaign-1"

function fakePrisma(ledger: Record<string, unknown> | null) {
  return {
    pushCampaign: {
      findUnique: vi.fn(async () => ({
        workflowRunLogId: ledger ? "ledger-1" : null,
      })),
    },
    workflowRun: { findUnique: vi.fn(async () => ledger) },
  } as never
}

function ledger(overrides: Record<string, unknown>) {
  return {
    id: "ledger-1",
    status: "RUNNING",
    details: { kind: "TEST", mode: "WAVE", audienceCount: null },
    startedAt: new Date("2026-10-06T09:00:30.000Z"),
    createdAt: new Date("2026-10-06T08:59:00.000Z"),
    ...overrides,
  }
}

describe("PUSH_TEST_RECEIPT_WINDOW_MS", () => {
  it("equals the wait before the workflow's last reconcile (KTD14)", () => {
    expect(PUSH_TEST_RECEIPT_WINDOW_MS).toBe(PUSH_FINAL_RECONCILE_DELAY_MS)
  })
})

describe("readPushTestRunState", () => {
  it("reads a running test as collecting receipts until its start plus the window", async () => {
    await expect(
      readPushTestRunState(fakePrisma(ledger({})), CAMPAIGN_ID),
    ).resolves.toEqual({
      running: true,
      receiptsUntil: new Date("2026-10-06T09:15:30.000Z"),
    })
  })

  it("takes the window from createdAt while the test is still queued", async () => {
    await expect(
      readPushTestRunState(
        fakePrisma(ledger({ status: "QUEUED", startedAt: null })),
        CAMPAIGN_ID,
      ),
    ).resolves.toEqual({
      running: true,
      receiptsUntil: new Date("2026-10-06T09:14:00.000Z"),
    })
  })

  it("does not read a live run in flight as a test", async () => {
    await expect(
      readPushTestRunState(
        fakePrisma(ledger({ details: { kind: "LIVE", mode: "WAVE" } })),
        CAMPAIGN_ID,
      ),
    ).resolves.toEqual({ running: false, receiptsUntil: null })
  })

  it("does not read a finished test as running", async () => {
    await expect(
      readPushTestRunState(
        fakePrisma(ledger({ status: "SUCCEEDED" })),
        CAMPAIGN_ID,
      ),
    ).resolves.toEqual({ running: false, receiptsUntil: null })
  })
})

describe("formatPushTestRunRefusal", () => {
  it("names the window end in UTC, rounded up to the next whole minute (KTD17)", () => {
    expect(formatPushTestRunRefusal(new Date("2026-10-06T09:15:30.000Z"))).toBe(
      "The last test is still collecting receipts until about 09:16 UTC. Send a new test after that.",
    )
    expect(formatPushTestRunRefusal(new Date("2026-10-06T09:14:00.000Z"))).toBe(
      "The last test is still collecting receipts until about 09:14 UTC. Send a new test after that.",
    )
  })
})
