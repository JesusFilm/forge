import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { adminMessages } from "@/i18n/messages"

const push = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

vi.mock("@/i18n/client", () => ({
  useAdminI18n: () => ({
    locale: "es",
    messages: adminMessages.es,
  }),
}))

import { LoginPageClient } from "./login-page-client"

describe("login UI", () => {
  it("renders translatable interface text from i18n dictionaries", () => {
    const html = renderToStaticMarkup(
      <LoginPageClient enabledProviders={["google"]} />,
    )

    expect(html).toContain(adminMessages.es.login.labels.signIn)
    expect(html).toContain(adminMessages.es.login.labels.welcomeBack)
    expect(html).toContain(adminMessages.es.login.labels.emailIdentity)
    expect(html).toContain(
      adminMessages.es.login.actions.continueWith.replace(
        "{provider}",
        "Google",
      ),
    )
  })

  it("hides social auth section when no providers are enabled", () => {
    const html = renderToStaticMarkup(<LoginPageClient enabledProviders={[]} />)

    expect(html).not.toContain(
      adminMessages.es.login.actions.continueWith.replace(
        "{provider}",
        "Google",
      ),
    )
  })

  it("renders a forbidden access message when redirected from admin", () => {
    const html = renderToStaticMarkup(
      <LoginPageClient enabledProviders={[]} initialError="forbidden" />,
    )

    expect(html).toContain(adminMessages.es.login.errors.forbidden)
  })
})
