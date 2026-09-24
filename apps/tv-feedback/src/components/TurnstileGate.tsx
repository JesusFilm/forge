"use client"

import { useEffect, useRef } from "react"

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string
          callback: (token: string) => void
          "expired-callback": () => void
        },
      ) => string
      remove: (id: string) => void
    }
  }
}

export function TurnstileGate({
  onToken,
}: {
  onToken: (token: string) => void
}) {
  const target = useRef<HTMLDivElement>(null)
  const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  useEffect(() => {
    if (!sitekey || !target.current) return
    const element = target.current
    let widget: string | undefined
    const render = () => {
      if (window.turnstile && !widget)
        widget = window.turnstile.render(element, {
          sitekey,
          callback: onToken,
          "expired-callback": () => onToken(""),
        })
    }
    const script = document.createElement("script")
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    script.async = true
    script.onload = render
    if (window.turnstile) render()
    else document.head.appendChild(script)
    return () => {
      if (widget) window.turnstile?.remove(widget)
      script.remove()
      onToken("")
    }
  }, [onToken, sitekey])

  return sitekey ? (
    <div ref={target} aria-label="Human verification" />
  ) : process.env.NODE_ENV === "development" ? null : (
    <p className="error-text">Feedback verification is unavailable.</p>
  )
}
