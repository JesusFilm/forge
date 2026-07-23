"use client"

export function scheduleAfterPageLoadAndIdle(
  callback: () => void,
  {
    idleTimeout = 2500,
    fallbackDelay = 250,
  }: {
    idleTimeout?: number
    fallbackDelay?: number
  } = {},
): () => void {
  if (typeof window === "undefined") return () => {}

  let cancelled = false
  let cancelIdle: (() => void) | null = null
  let loadListener: (() => void) | null = null

  const scheduleIdle = () => {
    if (cancelled) return
    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(callback, {
        timeout: idleTimeout,
      })
      cancelIdle = () => window.cancelIdleCallback?.(handle)
      return
    }

    const handle = globalThis.setTimeout(callback, fallbackDelay)
    cancelIdle = () => globalThis.clearTimeout(handle)
  }

  if (document.readyState === "complete") {
    scheduleIdle()
  } else {
    loadListener = scheduleIdle
    window.addEventListener("load", loadListener, { once: true })
  }

  return () => {
    cancelled = true
    cancelIdle?.()
    if (loadListener) window.removeEventListener("load", loadListener)
  }
}
