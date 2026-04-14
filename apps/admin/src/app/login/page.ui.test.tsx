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

import LoginPage from "./page"

describe("login UI", () => {
  it("renders translatable interface text from i18n dictionaries", () => {
    const html = renderToStaticMarkup(<LoginPage />)

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
})
