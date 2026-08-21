import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  hasPermission: vi.fn(),
  listReports: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
}))

vi.mock("@/auth/session", () => ({
  requireAdminSession: state.requireAdminSession,
}))
vi.mock("@/auth/permissions", () => ({ hasPermission: state.hasPermission }))
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("@/graphql/user-playlist-runtime", () => ({
  getUserPlaylistGraphqlRuntime: () => ({
    moderation: () => ({ listReports: state.listReports }),
  }),
}))
vi.mock("@/i18n/server", async () => {
  const { adminMessages } = await import("@/i18n/messages")
  return { getAdminMessages: async () => adminMessages.en }
})
vi.mock("next/navigation", () => ({
  redirect: state.redirect,
  useRouter: () => ({ refresh: vi.fn() }),
}))

import UserPlaylistModerationPage from "./page"

describe("dashboard / user playlist moderation page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.requireAdminSession.mockResolvedValue({
      id: "admin-1",
      role: "ADMIN",
    })
    state.hasPermission.mockReturnValue(true)
    state.listReports.mockResolvedValue({ items: [], nextCursor: null })
  })

  it("fails closed before loading queue data without the exact moderation permission", async () => {
    state.hasPermission.mockReturnValue(false)

    await expect(
      UserPlaylistModerationPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("redirect:/dashboard")
    expect(state.listReports).not.toHaveBeenCalled()
  })

  it("passes only the supported category and cursor filters and groups a page by playlist", async () => {
    state.listReports.mockResolvedValue({
      items: [
        {
          reportId: "report_1",
          playlistId: "playlist_1",
          category: "OTHER_SAFETY",
          detailPlainText: "Unsafe imagery",
          detailStatus: "AVAILABLE",
          createdAt: new Date("2026-08-21T12:00:00Z"),
        },
        {
          reportId: "report_2",
          playlistId: "playlist_1",
          category: "MISLEADING_OR_SPAM",
          detailPlainText: null,
          detailStatus: "ABSENT",
          createdAt: new Date("2026-08-21T11:00:00Z"),
        },
      ],
      nextCursor: "report_2",
    })

    const html = renderToStaticMarkup(
      await UserPlaylistModerationPage({
        searchParams: Promise.resolve({
          category: "OTHER_SAFETY",
          after: "report_0",
          status: "BLOCKED",
          minimumReports: "2",
        }),
      }),
    )

    expect(state.listReports).toHaveBeenCalledWith(
      { first: 50, after: "report_0", category: "OTHER_SAFETY" },
      { id: "admin-1", role: "ADMIN" },
    )
    expect(html.match(/playlist_1/g)?.length).toBeGreaterThanOrEqual(1)
    expect(html).toContain("2 reports")
    expect(html).toContain("after=report_2")
    expect(html).toContain("category=OTHER_SAFETY")
  })

  it("renders the explicit empty state", async () => {
    const html = renderToStaticMarkup(
      await UserPlaylistModerationPage({ searchParams: Promise.resolve({}) }),
    )
    expect(html).toContain("No reports match this filter")
  })
})
