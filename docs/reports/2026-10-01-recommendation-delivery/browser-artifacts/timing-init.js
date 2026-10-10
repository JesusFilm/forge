;(() => {
  const state = { playerShellMs: null, hydratedMs: null, requests: [] }
  window.__feat589Timing = state
  const observe = () => {
    if (
      state.playerShellMs === null &&
      document.querySelector('[data-testid="player-shell"]')
    )
      state.playerShellMs = performance.now()
    if (
      state.hydratedMs === null &&
      document.querySelector(
        '[data-testid="traffic-fixture"][data-hydrated="true"]',
      )
    )
      state.hydratedMs = performance.now()
  }
  new MutationObserver(observe).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-hydrated"],
  })
  const originalFetch = window.fetch.bind(window)
  window.fetch = async (...args) => {
    const path = new URL(
      typeof args[0] === "string" ? args[0] : args[0].url,
      location.href,
    ).pathname
    if (path !== "/watch/api/recommendations") return originalFetch(...args)
    const measurement = {
      path,
      startMs: performance.now(),
      playerPresentAtStart: !!document.querySelector(
        '[data-testid="player-shell"]',
      ),
    }
    state.requests.push(measurement)
    try {
      const response = await originalFetch(...args)
      measurement.endMs = performance.now()
      measurement.status = response.status
      const { delivery } = await response.clone().json()
      measurement.delivery = delivery
        ? {
            requestId: delivery.requestId,
            result: delivery.result,
            reason: delivery.reason,
            requestedCount: delivery.requestedCount,
            composedCount: delivery.composedCount,
            itemsCount: delivery.items.length,
          }
        : null
      return response
    } catch (error) {
      measurement.endMs = performance.now()
      measurement.error = error.name
      throw error
    }
  }
})()
