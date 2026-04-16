import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { AdminShell } from "@/components/admin-shell"
import { adminMessages } from "@/i18n/messages"

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ refresh: vi.fn() }),
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
  })

  it("hides admin-only routes for editor principals", () => {
    const html = renderToStaticMarkup(
      <AdminShell principal={{ id: "editor@forge.test", role: "EDITOR" }}>
        <div>content</div>
      </AdminShell>,
    )

    expect(html).not.toContain(adminMessages.es.nav.items.users.label)
    expect(html).not.toContain(adminMessages.es.nav.items.settings.label)
  })
})
