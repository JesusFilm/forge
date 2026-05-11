// @vitest-environment jsdom

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
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
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function mount(node: ReactNode) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root: Root = createRoot(container)

  act(() => {
    root.render(node)
  })

  return {
    container,
    cleanup() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe("admin shell", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
  })

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

  it("hides and restores the desktop sidebar", () => {
    const view = mount(
      <AdminShell principal={{ id: "admin@forge.test", role: "ADMIN" }}>
        <div>content</div>
      </AdminShell>,
    )
    cleanup = view.cleanup

    expect(view.container.innerHTML).toContain("xl:ml-[240px]")

    const hideButton = view.container.querySelector(
      'button[aria-label="Hide sidebar"]',
    ) as HTMLButtonElement | null
    expect(hideButton).not.toBeNull()

    act(() => {
      hideButton?.click()
    })

    expect(view.container.innerHTML).toContain("xl:ml-0")
    expect(
      view.container.querySelector('button[aria-label="Hide sidebar"]'),
    ).toBeNull()

    const showButton = view.container.querySelector(
      'button[aria-label="Show sidebar"]',
    ) as HTMLButtonElement | null
    expect(showButton).not.toBeNull()

    act(() => {
      showButton?.click()
    })

    expect(view.container.innerHTML).toContain("xl:ml-[240px]")
    expect(
      view.container.querySelector('button[aria-label="Show sidebar"]'),
    ).toBeNull()
    expect(
      view.container.querySelector('button[aria-label="Hide sidebar"]'),
    ).not.toBeNull()
  })

  it("keeps the desktop sidebar open when a nav link is clicked", () => {
    const view = mount(
      <AdminShell principal={{ id: "admin@forge.test", role: "ADMIN" }}>
        <div>content</div>
      </AdminShell>,
    )
    cleanup = view.cleanup

    const experiencesLink = view.container.querySelector(
      'a[href="/dashboard/experiences"]',
    ) as HTMLAnchorElement | null
    expect(experiencesLink).not.toBeNull()
    experiencesLink?.addEventListener("click", (event) => {
      event.preventDefault()
    })

    act(() => {
      experiencesLink?.click()
    })

    expect(view.container.innerHTML).toContain("xl:ml-[240px]")
    expect(
      view.container.querySelector('button[aria-label="Hide sidebar"]'),
    ).not.toBeNull()
    expect(
      view.container.querySelector('button[aria-label="Show sidebar"]'),
    ).toBeNull()
  })
})
