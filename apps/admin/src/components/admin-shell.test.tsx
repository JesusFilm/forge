import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import {
  AdminShell,
  shouldStartAdminNavigationFeedback,
} from "@/components/admin-shell"
import { adminMessages } from "@/i18n/messages"

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("@/i18n/client", () => ({
  useAdminI18n: () => ({
    locale: "es",
    messages: adminMessages.es,
  }),
}))

describe("admin shell", () => {
  it("renders translated nav and shell chrome", () => {
    const html = renderToStaticMarkup(
      <AdminShell principal={{ id: "admin@forge.test", role: "ADMIN" }}>
        <div>content</div>
      </AdminShell>,
    )

    expect(html).toContain(adminMessages.es.nav.sections.overview)
    expect(html).toContain(adminMessages.es.nav.items.dashboard.label)
    expect(html).toContain(adminMessages.es.common.locales.es)
    expect(html).toContain(
      `aria-label="${adminMessages.es.common.openCommandPalette}"`,
    )
    expect(html).toContain(
      `aria-label="${adminMessages.es.common.helpUnavailable}"`,
    )
    expect(html).toContain('aria-current="true"')
    expect(html).toMatch(
      new RegExp(
        `<button(?=[^>]*disabled="")(?=[^>]*aria-label="${adminMessages.es.common.helpUnavailable}")`,
      ),
    )
    expect(html).not.toContain('data-admin-navigation-feedback="pending"')
  })

  it("hides admin-only routes for editor principals", () => {
    const html = renderToStaticMarkup(
      <AdminShell principal={{ id: "editor@forge.test", role: "EDITOR" }}>
        <div>content</div>
      </AdminShell>,
    )

    expect(html).not.toContain(adminMessages.es.nav.items.users.label)
    expect(html).not.toContain(adminMessages.es.nav.items.settings.label)
    expect(html).not.toContain(adminMessages.es.nav.items.mcp.label)
  })

  it("recognizes internal dashboard navigation that should show pending feedback", () => {
    expect(
      shouldStartAdminNavigationFeedback({
        currentHref: "http://localhost:3003/dashboard",
        href: "http://localhost:3003/dashboard/videos",
      }),
    ).toBe(true)

    expect(
      shouldStartAdminNavigationFeedback({
        currentHref: "http://localhost:3003/dashboard/videos?page=1",
        href: "http://localhost:3003/dashboard/videos?page=2",
      }),
    ).toBe(true)
  })

  it("ignores links that should not start route feedback", () => {
    const currentHref = "http://localhost:3003/dashboard/videos?page=1"

    expect(
      shouldStartAdminNavigationFeedback({
        currentHref,
        href: "http://localhost:3003/dashboard/videos?page=1",
      }),
    ).toBe(false)
    expect(
      shouldStartAdminNavigationFeedback({
        currentHref,
        href: "https://www.jesusfilm.org/watch/easter.html",
      }),
    ).toBe(false)
    expect(
      shouldStartAdminNavigationFeedback({
        currentHref,
        href: "http://localhost:3003/dashboard-preview",
      }),
    ).toBe(false)
    expect(
      shouldStartAdminNavigationFeedback({
        currentHref,
        href: "http://localhost:3003/dashboard/languages",
        modified: true,
      }),
    ).toBe(false)
    expect(
      shouldStartAdminNavigationFeedback({
        currentHref,
        href: "http://localhost:3003/dashboard/languages",
        target: "_blank",
      }),
    ).toBe(false)
    expect(
      shouldStartAdminNavigationFeedback({
        currentHref,
        disabled: true,
        href: "http://localhost:3003/dashboard/languages",
      }),
    ).toBe(false)
  })
})
