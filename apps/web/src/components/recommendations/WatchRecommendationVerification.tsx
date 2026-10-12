"use client"

import { useEffect, useRef } from "react"

const SCRIPT_ID = "forge-watch-recommendation-turnstile"
const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string
      action: string
      appearance: "interaction-only"
      callback: (token: string) => void
      "error-callback": () => void
      "expired-callback": () => void
      "timeout-callback": () => void
    },
  ) => string
  remove: (widgetId: string) => void
}

function turnstileApi(): TurnstileApi | null {
  const candidate = (window as Window & { turnstile?: TurnstileApi }).turnstile
  return candidate &&
    typeof candidate.render === "function" &&
    typeof candidate.remove === "function"
    ? candidate
    : null
}

/** Mounted only after Admin reports that an active live cohort needs proof. */
export function WatchRecommendationVerification({
  siteKey,
  onToken,
  onFailure,
}: {
  siteKey: string
  onToken: (token: string) => void
  onFailure: () => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onToken, onFailure })

  useEffect(() => {
    callbacks.current = { onToken, onFailure }
  }, [onToken, onFailure])

  useEffect(() => {
    let disposed = false
    let widgetId: string | null = null
    let api: TurnstileApi | null = null
    const fail = () => callbacks.current.onFailure()
    const render = () => {
      if (disposed || !container.current || widgetId) return
      api = turnstileApi()
      if (!api) return
      try {
        widgetId = api.render(container.current, {
          sitekey: siteKey,
          action: "watch_recommendations",
          appearance: "interaction-only",
          callback: (token) => callbacks.current.onToken(token),
          "error-callback": fail,
          "expired-callback": fail,
          "timeout-callback": fail,
        })
      } catch {
        fail()
      }
    }
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (!script) {
      script = document.createElement("script")
      script.id = SCRIPT_ID
      script.src = SCRIPT_URL
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
    script.addEventListener("load", render)
    script.addEventListener("error", fail)
    // A previous Watch navigation may already have loaded the shared script.
    render()
    return () => {
      disposed = true
      script?.removeEventListener("load", render)
      script?.removeEventListener("error", fail)
      if (widgetId && api) api.remove(widgetId)
    }
  }, [siteKey])

  return <div ref={container} aria-label="Verify recommendations" />
}
