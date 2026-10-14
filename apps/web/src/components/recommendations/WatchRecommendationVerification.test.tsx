/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WatchRecommendationVerification } from "./WatchRecommendationVerification"

afterEach(() => {
  document.getElementById("forge-watch-recommendation-turnstile")?.remove()
  delete (window as Window & { turnstile?: unknown }).turnstile
})

describe("conditional Watch recommendation verification widget", () => {
  it("runs only when mounted with the dedicated action and removes its widget", () => {
    const render = vi.fn(
      (
        _element: HTMLElement,
        _options: {
          sitekey: string
          action: string
          appearance: string
          callback: (token: string) => void
        },
      ) => "widget-1",
    )
    const remove = vi.fn()
    const onToken = vi.fn()
    const onFailure = vi.fn()
    ;(window as Window & { turnstile?: unknown }).turnstile = {
      render,
      remove,
    }
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        <WatchRecommendationVerification
          siteKey="watch-site-key"
          onToken={onToken}
          onFailure={onFailure}
        />,
      )
    })
    expect(
      (
        document.getElementById(
          "forge-watch-recommendation-turnstile",
        ) as HTMLScriptElement
      ).src,
    ).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    )
    expect(render).toHaveBeenCalledOnce()
    expect(render.mock.calls[0]?.[1]).toMatchObject({
      sitekey: "watch-site-key",
      action: "watch_recommendations",
      appearance: "interaction-only",
    })
    render.mock.calls[0]?.[1].callback("opaque-token")
    expect(onToken).toHaveBeenCalledWith("opaque-token")
    act(() => root.unmount())
    expect(remove).toHaveBeenCalledWith("widget-1")
    host.remove()
  })
})
