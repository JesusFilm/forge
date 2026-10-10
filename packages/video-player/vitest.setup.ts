globalThis.IS_REACT_ACT_ENVIRONMENT = true

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(
      () => callback(performance.now()),
      0,
    )) as typeof requestAnimationFrame
}

if (!globalThis.cancelAnimationFrame) {
  globalThis.cancelAnimationFrame = ((handle: number) =>
    clearTimeout(handle)) as typeof cancelAnimationFrame
}
