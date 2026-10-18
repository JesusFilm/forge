// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"
import { setRequestLocale } from "next-intl/server"
import arabicMessages from "../../../messages/ar.json"
import spanishMessages from "../../../messages/es.json"
import chineseMessages from "../../../messages/zh-Hans.json"
import englishMessages from "../../../messages/en.json"
import { WatchNoScriptNotice } from "./WatchNoScriptNotice"

afterEach(() => {
  setRequestLocale("en")
  document.body.innerHTML = ""
})

describe("WatchNoScriptNotice", () => {
  it("keeps the header-clearance container and copy inside noscript only", () => {
    const html = renderToStaticMarkup(<WatchNoScriptNotice />)
    const documentHtml = `<body>${html}<main>Watch page</main></body>`
    // Parser coverage only: real header geometry is verified in a browser.
    // DOMParser disables scripting; the Vitest document has scripting enabled.
    const withoutScripts = new DOMParser().parseFromString(
      documentHtml,
      "text/html",
    )
    document.body.innerHTML = documentHtml
    const notice = withoutScripts.querySelector(
      '[data-testid="watch-noscript-notice"]',
    )
    const clearance = notice?.parentElement

    expect(clearance?.tagName).toBe("DIV")
    expect(clearance?.parentElement?.tagName).toBe("NOSCRIPT")
    expect(withoutScripts.body.children).toHaveLength(2)
    expect(document.querySelector("p, div")).toBeNull()
    expect(document.querySelector("main")?.textContent).toBe("Watch page")
  })

  // Asserted on the server-rendered HTML because that is the only place the
  // note exists for its audience: a browser with JavaScript off never runs the
  // client bundle, and one with JavaScript on never renders <noscript>.
  it.each([
    ["en", englishMessages],
    ["ar", arabicMessages],
    ["es", spanishMessages],
    ["zh-Hans", chineseMessages],
  ])("server-renders the %s note inside <noscript>", (locale, messages) => {
    setRequestLocale(locale)
    const html = renderToStaticMarkup(<WatchNoScriptNotice />)

    expect(html.startsWith("<noscript>")).toBe(true)
    expect(html.endsWith("</noscript>")).toBe(true)
    expect(html).toContain(messages.WatchNoScript.message)
  })
})
