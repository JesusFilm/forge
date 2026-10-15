// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { RECOMMENDATION_COOKIE_SETTINGS_OPEN_EVENT } from "@/lib/recommendation-consent"
import { RecommendationCookieSettingsTrigger } from "./RecommendationCookieSettingsTrigger"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root.render(
      <RecommendationCookieSettingsTrigger label="Cookie settings" />,
    ),
  )
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("RecommendationCookieSettingsTrigger", () => {
  it("shows the pointer cursor, which Tailwind preflight resets on buttons", () => {
    const button = container.querySelector("button")
    expect(button?.classList.contains("cursor-pointer")).toBe(true)
  })

  it("keeps the 44px target", () => {
    const button = container.querySelector("button")
    expect(button?.classList.contains("min-h-11")).toBe(true)
  })

  it("opens the cookie settings with the trigger as the return-focus target", () => {
    const listener = vi.fn()
    window.addEventListener(RECOMMENDATION_COOKIE_SETTINGS_OPEN_EVENT, listener)
    const button = container.querySelector("button") as HTMLButtonElement
    act(() => button.click())
    window.removeEventListener(
      RECOMMENDATION_COOKIE_SETTINGS_OPEN_EVENT,
      listener,
    )
    expect(listener).toHaveBeenCalledTimes(1)
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toBe(button)
  })
})
