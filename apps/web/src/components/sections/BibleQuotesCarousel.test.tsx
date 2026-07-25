/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}))

import { BibleQuotesCarousel } from "./BibleQuotesCarousel"

let container: HTMLDivElement
let root: Root

const data = {
  id: "quotes",
  heading: "Bible Quotes",
  quotes: [
    {
      id: "quote-1",
      reference: "John 3:16",
      text: "For God so loved the world.",
      attribution: null,
      imageUrl: null,
      backgroundColor: null,
      ctaLabel: null,
      ctaLink: null,
    },
  ],
} as unknown as Parameters<typeof BibleQuotesCarousel>[0]["data"]

function setNativeShare(share: typeof navigator.share | undefined) {
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: share,
  })
}

function setClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  })
}

function shareButton(): HTMLButtonElement {
  return container.querySelector('button[aria-label="share"]')!
}

beforeEach(() => {
  window.history.replaceState({}, "", "/watch")
  setNativeShare(undefined)
  setClipboard(vi.fn(() => Promise.resolve()))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe("BibleQuotesCarousel Share", () => {
  it("shares a contextual local route by its public standalone identity", async () => {
    window.history.replaceState(
      {},
      "",
      "/watch/lumo-the-gospel-of-john.html/the-call/english.html",
    )
    const share = vi.fn(() => Promise.resolve())
    setNativeShare(share)

    act(() => root.render(<BibleQuotesCarousel data={data} />))
    await act(async () => shareButton().click())

    expect(share).toHaveBeenCalledWith({
      title: "Bible Quotes",
      text: "",
      url: "https://www.jesusfilm.org/watch/the-call.html?utm_source=share",
    })
  })

  it("copies a public Watch-home URL when native Share is unavailable", async () => {
    const writeText = vi.fn(() => Promise.resolve())
    setClipboard(writeText)

    act(() => root.render(<BibleQuotesCarousel data={data} />))
    await act(async () => shareButton().click())

    expect(writeText).toHaveBeenCalledWith(
      "https://www.jesusfilm.org/watch?utm_source=share",
    )
  })

  it("does not share an unknown Watch route", async () => {
    window.history.replaceState({}, "", "/watch/not/a/recognized/route")
    const share = vi.fn(() => Promise.resolve())
    const writeText = vi.fn(() => Promise.resolve())
    setNativeShare(share)
    setClipboard(writeText)

    act(() => root.render(<BibleQuotesCarousel data={data} />))
    await act(async () => shareButton().click())

    expect(share).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
  })
})
