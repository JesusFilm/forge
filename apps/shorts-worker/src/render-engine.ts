// Shared Remotion adapter for devotional rendering. Imports remain lazy so
// loading the authenticated worker does not start Chromium or bundle code.

export type EngineBrowser = {
  close(options: { silent: boolean }): Promise<unknown>
}

export type EngineComposition = {
  id: string
  width: number
  height: number
  fps: number
  durationInFrames: number
}

export type RenderEngine = {
  bundle(options: {
    entryPoint: string
    publicDir?: string
    outDir?: string
  }): Promise<string>
  openBrowser(): Promise<EngineBrowser>
  selectComposition(options: {
    serveUrl: string
    id: string
    inputProps: Record<string, unknown>
    puppeteerInstance: EngineBrowser
    timeoutInMilliseconds: number
  }): Promise<EngineComposition>
  renderMedia(options: {
    composition: EngineComposition
    serveUrl: string
    codec: "h264"
    outputLocation: string
    inputProps: Record<string, unknown>
    puppeteerInstance: EngineBrowser
    concurrency: number
    offthreadVideoCacheSizeInBytes: number
    timeoutInMilliseconds: number
    onProgress: (progress: { progress: number }) => void
  }): Promise<unknown>
}

export function createDefaultRenderEngine(): RenderEngine {
  return {
    async bundle({ entryPoint, publicDir, outDir }) {
      const { bundle } = await import("@remotion/bundler")
      return bundle({
        entryPoint,
        publicDir,
        outDir,
        webpackOverride: (config) => config,
      })
    },
    async openBrowser() {
      const { openBrowser } = await import("@remotion/renderer")
      const browser = await openBrowser("chrome")
      return browser as unknown as EngineBrowser
    },
    async selectComposition(options) {
      const { selectComposition } = await import("@remotion/renderer")
      const composition = await selectComposition({
        serveUrl: options.serveUrl,
        id: options.id,
        inputProps: options.inputProps,
        puppeteerInstance: options.puppeteerInstance as unknown as Parameters<
          typeof selectComposition
        >[0]["puppeteerInstance"],
        timeoutInMilliseconds: options.timeoutInMilliseconds,
      })
      return composition as unknown as EngineComposition
    },
    async renderMedia(options) {
      const { renderMedia } = await import("@remotion/renderer")
      return renderMedia({
        composition: options.composition as unknown as Parameters<
          typeof renderMedia
        >[0]["composition"],
        serveUrl: options.serveUrl,
        codec: options.codec,
        outputLocation: options.outputLocation,
        inputProps: options.inputProps,
        puppeteerInstance: options.puppeteerInstance as unknown as Parameters<
          typeof renderMedia
        >[0]["puppeteerInstance"],
        concurrency: options.concurrency,
        offthreadVideoCacheSizeInBytes: options.offthreadVideoCacheSizeInBytes,
        timeoutInMilliseconds: options.timeoutInMilliseconds,
        onProgress: options.onProgress,
      })
    },
  }
}
