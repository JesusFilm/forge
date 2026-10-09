/** @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"
import messages from "../../../messages/en.json"
import { WatchHomePromo } from "./WatchHomePromo"

describe("Watch homepage promo", () => {
  it("keeps the ministry information without inviting viewers into the retired beta program", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WatchHomePromo />
      </NextIntlClientProvider>,
    )
    const container = document.createElement("div")
    container.innerHTML = html
    expect(container.textContent).toContain(messages.WatchHomePromo.title)
    expect(html).not.toContain(messages.WatchHomePromo.betaTester)
    expect(html).not.toContain(messages.WatchHomePromo.invitationDescription)
    expect(html).not.toContain("mailchi.mp/jesusfilm/beta")
  })
})
