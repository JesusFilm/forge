import { renderToStaticMarkup } from "react-dom/server"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { adminMessages } from "@/i18n/messages"

const uiMessages = {
  common: adminMessages.es.common,
  pages: adminMessages.en.pages,
}

vi.mock("@/i18n/server", () => ({
  getAdminMessages: vi.fn(async () => uiMessages as never),
}))

vi.mock("@/auth/session", () => ({
  requireSession: vi.fn(async () => ({ id: "test-user", role: "ADMIN" })),
}))

vi.mock("@/app/dashboard/live-data", () => ({
  loadExperienceRows: vi.fn(async () => [
    {
      key: "exp_1",
      title: "Stories of Forgiveness",
      slug: "/exp/forgiveness-v4-global",
      owner: "M. Rodriguez",
      statusLabel: "PUBLISHED",
      statusTone: "success",
      embedding: "READY",
      updated: "10/24/2023, 14:02",
    },
  ]),
  loadVideoRows: vi.fn(async () => [
    {
      key: "vid_1",
      title: "Neon Genesis: The Digital Divide",
      id: "vid_8829_x_alpha_92",
      sourceLabel: "Mux",
      sourceTone: "info",
      dubs: "EN, ES, FR",
      updated: "10/24/2023, 14:02",
      duration: "04:22",
    },
  ]),
}))

import DashboardPage from "./page"
import SystemStatusPage from "./system-status/page"
import ExperiencesPage from "./experiences/page"
import VideosPage from "./videos/page"
import WorkflowsPage from "./workflows/page"
import EmbeddingsPage from "./embeddings/page"
import SearchPage from "./search/page"
import UsersPage from "./users/page"
import SettingsPage from "./settings/page"
import LanguagesPage from "./languages/page"
import MediaPage from "./media/page"

async function htmlFrom(component: Promise<ReactNode>) {
  return renderToStaticMarkup(await component)
}

describe("dashboard UI routes", () => {
  it("renders overview page with translated shared chrome", async () => {
    const html = await htmlFrom(DashboardPage())

    expect(html).toContain(uiMessages.pages.dashboard.title)
    expect(html).toContain(uiMessages.pages.dashboard.action)
    expect(html).toContain(uiMessages.common.operatorNotes)
  })

  it("renders experiences page from i18n dictionaries", async () => {
    const html = await htmlFrom(ExperiencesPage())
    expect(html).toContain(uiMessages.pages.experiences.title)
    expect(html).toContain(uiMessages.pages.experiences.actions.primary)
    expect(html).toContain(uiMessages.common.operatorNotes)
  })

  it("renders videos page with localized info strip and actions", async () => {
    const html = await htmlFrom(VideosPage())
    expect(html).toContain(uiMessages.pages.videos.infoStrip.items[0])
    expect(html).toContain(uiMessages.pages.videos.actions.primary)
    expect(html).toContain(uiMessages.common.operatorNotes)
  })

  it("renders core sync page with translated operator rail header", async () => {
    const html = await htmlFrom(SystemStatusPage())
    expect(html).toContain(uiMessages.pages.systemStatus.title)
    expect(html).toContain(uiMessages.pages.systemStatus.action)
    expect(html).toContain(uiMessages.common.operatorNotes)
  })

  it("renders all stub routes through shared premium stub surface", async () => {
    const pages = [
      {
        html: await htmlFrom(WorkflowsPage()),
        title: uiMessages.pages.workflows.title,
      },
      {
        html: await htmlFrom(EmbeddingsPage()),
        title: uiMessages.pages.embeddings.title,
      },
      {
        html: await htmlFrom(SearchPage()),
        title: uiMessages.pages.search.title,
      },
      {
        html: await htmlFrom(UsersPage()),
        title: uiMessages.pages.users.title,
      },
      {
        html: await htmlFrom(SettingsPage()),
        title: uiMessages.pages.settings.title,
      },
      {
        html: await htmlFrom(LanguagesPage()),
        title: uiMessages.pages.languages.title,
      },
      {
        html: await htmlFrom(MediaPage()),
        title: uiMessages.pages.media.title,
      },
    ]

    for (const page of pages) {
      expect(page.html).toContain(page.title.replaceAll("&", "&amp;"))
      expect(page.html).toContain(uiMessages.common.premiumStubLabel)
      expect(page.html).toContain(uiMessages.common.operatorNotes)
    }
  })
})
