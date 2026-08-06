// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { EnglishAssistGuide } from "./EnglishAssistGuide"

describe("EnglishAssistGuide", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    document.body.innerHTML = ""
  })

  it("opens an English dialog and returns focus on close", async () => {
    act(() => root.render(<EnglishAssistGuide />))
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="english-assist-guide-trigger"]',
    )

    expect(trigger?.textContent).toContain("EN")
    expect(trigger?.getAttribute("aria-label")).toBe("Open English help")
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")

    await act(async () => trigger?.click())

    const dialog = document.querySelector<HTMLElement>(
      '[data-testid="english-assist-guide-dialog"]',
    )
    expect(dialog?.getAttribute("lang")).toBe("en")
    expect(dialog?.getAttribute("dir")).toBe("ltr")
    expect(dialog?.textContent).toContain("English navigation help")
    expect(dialog?.textContent).toContain("Choose a language collection")
    expect(dialog?.textContent).toContain(
      "Subtitles are available without dubbed audio",
    )
    expect(trigger?.getAttribute("aria-expanded")).toBe("true")

    const close = document.querySelector<HTMLButtonElement>(
      '[data-testid="english-assist-guide-close"]',
    )
    await act(async () => close?.click())
    await act(async () => undefined)

    expect(
      document.querySelector('[data-testid="english-assist-guide-dialog"]'),
    ).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
  })
})
