import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { adminMessages } from "@/i18n/messages"
import type { PushCampaignDetail } from "@/services/push/dashboard.service"
import type {
  PushCampaignReport,
  PushReportCounts,
} from "@/services/push/report.service"

const uiMessages = {
  common: adminMessages.en.common,
  pages: adminMessages.en.pages,
}
const page = adminMessages.en.pages.pushCampaigns

type ActionsProps = Record<string, unknown>

const state: {
  role: "PUBLIC" | "VIEWER"
  campaign: PushCampaignDetail | null
  report: PushCampaignReport | null
  worker: { kind: "online" | "stale" | "unknown"; workers: [] }
  campaignsEnabled: boolean
  runState: { error: string | null } | null
  actionsProps: ActionsProps[]
  editorProps: ActionsProps[]
} = {
  role: "VIEWER",
  campaign: null,
  report: null,
  worker: { kind: "online", workers: [] },
  campaignsEnabled: true,
  runState: null,
  actionsProps: [],
  editorProps: [],
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
  readPushCampaignDetail: vi.fn(async () => state.campaign),
  listPushLanguageOptions: vi.fn(async () => [
    { slug: "english", label: "English" },
  ]),
  readPushDestinationTitle: vi.fn(async () => "JESUS"),
  readPushWorkerState: vi.fn(async () => state.worker),
}))

vi.mock("@/services/push/campaign.service", () => ({
  readPushTestSendOutcome: vi.fn(async () => []),
}))

vi.mock("@/services/push/audience.service", () => ({
  countPushAudience: vi.fn(async () => ({ audience: 1234, unreachable: 7 })),
}))

vi.mock("@/services/push/dispatch", () => ({
  readPushCampaignRunState: vi.fn(async () => state.runState),
}))

vi.mock("@/services/push/report.service", () => ({
  readPushCampaignReport: vi.fn(async () => state.report),
}))

vi.mock("@/services/push/transport", () => ({
  resolvePushSendConfig: () => ({ campaignsEnabled: state.campaignsEnabled }),
}))

vi.mock("../actions", () => ({
  refreshReportAction: vi.fn(async () => {}),
}))

// The editor and the action bar are client components; the page test proves
// which shell the page chose and what it handed them.
vi.mock("../components/campaign-editor", () => ({
  CampaignEditor: (props: ActionsProps) => {
    state.editorProps.push(props)
    return <div data-testid="stub-campaign-editor" />
  },
}))

vi.mock("../components/campaign-actions", () => ({
  CampaignActions: (props: ActionsProps) => {
    state.actionsProps.push(props)
    return <div data-testid="stub-campaign-actions" />
  },
}))

import PushCampaignPage from "./page"

async function html(node: Promise<ReactNode>): Promise<string> {
  return renderToStaticMarkup(await node)
}

function render(options: { tab?: string } = {}) {
  return html(
    PushCampaignPage({
      params: Promise.resolve({ id: "c1" }),
      searchParams: Promise.resolve(options.tab ? { tab: options.tab } : {}),
    }),
  )
}

function campaign(
  overrides: Partial<PushCampaignDetail> = {},
): PushCampaignDetail {
  return {
    id: "c1",
    status: "DRAFT",
    mode: "WAVE",
    englishTitle: "An announcement",
    languageCount: 1,
    destinationKind: "SERIES",
    destinationSlug: "jesus",
    audienceScope: "COUNTRIES",
    countries: ["SA"],
    languageFilter: [],
    sendDate: null,
    localHour: null,
    testSentAt: null,
    sendingStartedAt: null,
    completedAt: null,
    lastError: null,
    createdAt: new Date("2026-09-20T00:00:00Z"),
    updatedAt: new Date("2026-09-20T00:00:00Z"),
    copies: [
      {
        languageSlug: "english",
        title: "An announcement",
        body: "Watch tonight",
      },
    ],
    ...overrides,
  }
}

function counts(overrides: Partial<PushReportCounts> = {}): PushReportCounts {
  return {
    audience: 100,
    accepted: 80,
    handedOff: 70,
    unknown: 2,
    pending: 1,
    failed: 3,
    invalid: 4,
    suppressed: 5,
    unreachable: 6,
    missed: 7,
    opened: 20,
    attributed: 9,
    attributedWatchStarts: 11,
    ...overrides,
  }
}

function report(
  overrides: Partial<PushCampaignReport> = {},
): PushCampaignReport {
  return {
    campaignId: "c1",
    status: "SENT",
    sendingStartedAt: new Date("2026-10-01T06:00:00Z"),
    completedAt: new Date("2026-10-02T06:00:00Z"),
    generatedAt: new Date("2026-10-02T07:00:00Z"),
    totals: counts(),
    byLanguage: [{ key: "english", counts: counts() }],
    byCountry: [
      { key: "SA", counts: counts() },
      { key: "(unknown)", counts: counts() },
    ],
    ...overrides,
  }
}

describe("push campaign editor page", () => {
  beforeEach(() => {
    state.role = "VIEWER"
    state.campaign = campaign()
    state.report = null
    state.worker = { kind: "online", workers: [] }
    state.campaignsEnabled = true
    state.runState = null
    state.actionsProps = []
    state.editorProps = []
  })

  it("sends a principal without the campaign permission to the dashboard", async () => {
    state.role = "PUBLIC"
    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/dashboard")
  })

  it("renders the not-found view for a campaign that is gone", async () => {
    state.campaign = null
    const markup = await render()
    expect(markup).toContain(page.editor.notFoundTitle)
    expect(markup).not.toContain('data-testid="stub-campaign-editor"')
  })

  it("renders the editable form for a draft", async () => {
    const markup = await render()
    expect(markup).toContain('data-testid="stub-campaign-editor"')
    expect(markup).not.toContain('data-testid="push-freeze-notice"')
    expect(state.actionsProps[0]).toMatchObject({
      tested: false,
      frozen: false,
      cancellable: false,
      audience: 1234,
      unreachable: 7,
    })
  })

  it("replaces the form with the read-only view and the freeze rule when sending (AE12)", async () => {
    state.campaign = campaign({
      status: "SENDING",
      sendingStartedAt: new Date("2026-10-01T06:00:00Z"),
    })
    const markup = await render()
    expect(markup).toContain('data-testid="push-freeze-notice"')
    expect(markup).toContain(page.editor.frozenNotice)
    expect(markup).toContain('data-testid="push-frozen-copies"')
    expect(markup).toContain("Watch tonight")
    expect(markup).not.toContain('data-testid="stub-campaign-editor"')
    expect(state.actionsProps[0]).toMatchObject({
      frozen: true,
      cancellable: true,
    })
  })

  it("marks a tested campaign as tested so the untested notice is not shown", async () => {
    state.campaign = campaign({ status: "TESTED" })
    await render()
    expect(state.actionsProps[0]).toMatchObject({ tested: true, frozen: false })
  })

  it("passes the kill-switch posture through to the action bar (KTD12)", async () => {
    state.campaignsEnabled = false
    await render()
    expect(state.actionsProps[0]).toMatchObject({ campaignsEnabled: false })
  })

  it("surfaces the last run error when one is recorded", async () => {
    state.runState = { error: "provider_auth" }
    const markup = await render()
    expect(markup).toContain('data-testid="push-run-error"')
    expect(markup).toContain("provider_auth")
  })

  it("renders the not-started placeholder on the report tab before the first group", async () => {
    state.report = report({ sendingStartedAt: null, status: "DRAFT" })
    const markup = await render({ tab: "report" })
    expect(markup).toContain('data-testid="push-report-not-started"')
    expect(markup).toContain(page.report.notStartedTitle)
    expect(markup).toContain('data-testid="push-report-refresh"')
    expect(markup).not.toContain('data-testid="push-report-by-country"')
  })

  it("renders every report column and both splits for a sent campaign (R25)", async () => {
    state.report = report()
    const markup = await render({ tab: "report" })
    for (const label of Object.values(page.report.columns)) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('data-testid="push-report-by-language"')
    expect(markup).toContain('data-testid="push-report-by-country"')
    expect(markup).toContain("(unknown)")
    // R25/R26 — the missed and unreachable rows have to be readable.
    expect(markup).toContain('data-testid="push-report-missed"')
    expect(markup).toContain('data-testid="push-report-unreachable"')
    expect(markup).toContain('data-testid="push-report-refresh"')
  })

  it("names the stale-worker state on the report tab", async () => {
    state.report = report()
    state.worker = { kind: "stale", workers: [] }
    const markup = await render({ tab: "report" })
    expect(markup).toContain('data-testid="push-report-worker-state"')
    expect(markup).toContain(page.workerStale)
  })

  it("keeps the worker notice off the report when a worker is online", async () => {
    state.report = report()
    const markup = await render({ tab: "report" })
    expect(markup).not.toContain('data-testid="push-report-worker-state"')
  })
})
