import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { adminMessages } from "@/i18n/messages"
import type { PushCampaignListRow } from "@/services/push/dashboard.service"
import type { WorkflowWorkerStatusRow } from "@/services/workflow-worker-heartbeat.service"

const uiMessages = {
  common: adminMessages.en.common,
  pages: adminMessages.en.pages,
}
const page = adminMessages.en.pages.pushCampaigns

const state: {
  role: "PUBLIC" | "VIEWER" | "ADMIN"
  campaigns: PushCampaignListRow[]
  registrations: Array<{ day: string; count: number }>
  worker: {
    kind: "online" | "stale" | "unknown"
    workers: WorkflowWorkerStatusRow[]
  }
  campaignsEnabled: boolean
} = {
  role: "VIEWER",
  campaigns: [],
  registrations: [],
  worker: { kind: "online", workers: [] },
  campaignsEnabled: true,
}

vi.mock("@/i18n/server", () => ({
  getAdminMessages: vi.fn(async () => uiMessages as never),
}))

vi.mock("@/auth/session", () => ({
  requireSession: vi.fn(async () => ({ id: "user_1", role: state.role })),
}))

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
}))

vi.mock("@/db/client", () => ({ prisma: {} }))

vi.mock("@/services/push/dashboard.service", () => ({
  listPushCampaigns: vi.fn(async () => state.campaigns),
  readPushRegistrationsPerDay: vi.fn(async () => state.registrations),
  readPushWorkerState: vi.fn(async () => state.worker),
}))

vi.mock("@/services/push/transport", () => ({
  resolvePushSendConfig: () => ({ campaignsEnabled: state.campaignsEnabled }),
}))

vi.mock("./actions", () => ({
  createCampaignAction: vi.fn(async () => {}),
}))

import PushCampaignsPage from "./page"

async function html(node: Promise<ReactNode>): Promise<string> {
  return renderToStaticMarkup(await node)
}

function campaign(
  overrides: Partial<PushCampaignListRow> = {},
): PushCampaignListRow {
  return {
    id: "c1",
    status: "SENDING",
    mode: "WAVE",
    englishTitle: "An announcement",
    languageCount: 2,
    destinationKind: "SERIES",
    destinationSlug: "jesus",
    audienceScope: "COUNTRIES",
    countries: ["SA", "FR"],
    languageFilter: [],
    sendDate: new Date("2026-10-01T00:00:00Z"),
    localHour: 9,
    testSentAt: new Date("2026-09-30T00:00:00Z"),
    sendingStartedAt: new Date("2026-10-01T06:00:00Z"),
    completedAt: null,
    updatedAt: new Date("2026-10-01T06:05:00Z"),
    ...overrides,
  }
}

describe("push campaigns list page", () => {
  beforeEach(() => {
    state.role = "VIEWER"
    state.campaigns = []
    state.registrations = []
    state.worker = { kind: "online", workers: [] }
    state.campaignsEnabled = true
  })

  it("sends a principal without the campaign permission to the dashboard", async () => {
    state.role = "PUBLIC"
    await expect(html(PushCampaignsPage())).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    )
  })

  it("renders the empty state and points at the new-campaign action", async () => {
    const markup = await html(PushCampaignsPage())
    expect(markup).toContain(page.emptyTitle)
    expect(markup).toContain(page.emptyDescription)
    expect(markup).toContain('data-testid="push-new-campaign-empty"')
  })

  it("renders one row per campaign with its status, destination, and audience", async () => {
    state.campaigns = [campaign()]
    const markup = await html(PushCampaignsPage())
    expect(markup).toContain("An announcement")
    expect(markup).toContain("Sending")
    expect(markup).toContain("series / jesus")
    expect(markup).toContain("SA, FR")
    expect(markup).toContain("2026-10-01 at 09:00 local")
    expect(markup).toContain("/dashboard/push-campaigns/c1")
    expect(markup).not.toContain(page.emptyTitle)
  })

  it("names an untitled campaign rather than rendering a blank cell", async () => {
    state.campaigns = [campaign({ englishTitle: null })]
    const markup = await html(PushCampaignsPage())
    expect(markup).toContain("Untitled campaign")
  })

  it("shows registrations per day once a phone has registered", async () => {
    state.registrations = [
      { day: "2026-09-19", count: 0 },
      { day: "2026-09-20", count: 4 },
    ]
    const markup = await html(PushCampaignsPage())
    expect(markup).toContain('data-testid="push-registrations"')
    expect(markup).toContain("4 phone(s) registered")
  })

  it("shows the measured-zero registration state when nothing has registered", async () => {
    state.registrations = [{ day: "2026-09-20", count: 0 }]
    const markup = await html(PushCampaignsPage())
    expect(markup).toContain(page.registrationsEmpty)
  })

  it("names the stale-worker state, which stops a wave from sending", async () => {
    state.worker = {
      kind: "stale",
      workers: [
        {
          id: "admin:host:1",
          statusLabel: "Stale",
          statusTone: "danger",
          meta: "admin / started 2h ago",
          detail: "Last heartbeat 9m ago.",
        },
      ],
    }
    const markup = await html(PushCampaignsPage())
    expect(markup).toContain(page.workerStale)
    expect(markup).toContain("admin:host:1")
  })

  it("distinguishes an unreadable heartbeat from a stale worker", async () => {
    state.worker = { kind: "unknown", workers: [] }
    const markup = await html(PushCampaignsPage())
    expect(markup).toContain(page.workerUnknown)
    expect(markup).not.toContain(page.workerStale)
  })

  it("names the kill switch when the push flag is off (KTD12)", async () => {
    state.campaignsEnabled = false
    const markup = await html(PushCampaignsPage())
    expect(markup).toContain(page.flagOffTitle)
    expect(markup).toContain('data-testid="push-flag-off-banner"')
  })

  it("hides the kill-switch banner when the flag is on", async () => {
    const markup = await html(PushCampaignsPage())
    expect(markup).not.toContain('data-testid="push-flag-off-banner"')
  })
})
