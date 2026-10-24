/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RECOMMENDATION_COOKIE_SETTINGS_OPEN_EVENT } from "@/lib/recommendation-consent"
import { RecommendationPersonalizationControl } from "./RecommendationPersonalizationControl"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("RecommendationPersonalizationControl", () => {
  it("opens the global cookie settings as a secondary shortcut", () => {
    const listener = vi.fn()
    window.addEventListener(RECOMMENDATION_COOKIE_SETTINGS_OPEN_EVENT, listener)
    act(() => root.render(<RecommendationPersonalizationControl />))
    const trigger = container.querySelector("button")!
    act(() => trigger.click())

    expect(listener).toHaveBeenCalledOnce()
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toBe(trigger)
    window.removeEventListener(
      RECOMMENDATION_COOKIE_SETTINGS_OPEN_EVENT,
      listener,
    )
  })
})
