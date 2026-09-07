import { beforeEach, describe, expect, it, vi } from "vitest"

const adapter = vi.hoisted(() => ({
  bundle: vi.fn(),
  openBrowser: vi.fn(),
  selectComposition: vi.fn(),
  renderMedia: vi.fn(),
}))
vi.mock("@remotion/bundler", () => ({ bundle: adapter.bundle }))
vi.mock("@remotion/renderer", () => adapter)

import { createDefaultRenderEngine } from "./render-engine.js"

beforeEach(() => vi.resetAllMocks())

describe("devotional Remotion engine", () => {
  it("preserves bundle, browser and render options across the adapter", async () => {
    const browser = { close: vi.fn(async () => {}) }
    const composition = {
      id: "Devotional",
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 300,
    }
    adapter.bundle.mockResolvedValue("/retained/devotional-bundle")
    adapter.openBrowser.mockResolvedValue(browser)
    adapter.selectComposition.mockResolvedValue(composition)
    const engine = createDefaultRenderEngine()
    expect(adapter.openBrowser).not.toHaveBeenCalled()
    expect(
      await engine.bundle({
        entryPoint: "/entry.ts",
        publicDir: "/fonts",
        outDir: "/bundle",
      }),
    ).toBe("/retained/devotional-bundle")
    expect(adapter.bundle).toHaveBeenCalledWith(
      expect.objectContaining({
        entryPoint: "/entry.ts",
        publicDir: "/fonts",
        outDir: "/bundle",
      }),
    )
    expect(await engine.openBrowser()).toBe(browser)
    expect(adapter.openBrowser).toHaveBeenCalledWith("chrome")
    const selection = {
      serveUrl: "/bundle",
      id: "Devotional",
      inputProps: { title: "Retained" },
      puppeteerInstance: browser,
      timeoutInMilliseconds: 7500,
    }
    expect(await engine.selectComposition(selection)).toBe(composition)
    expect(adapter.selectComposition).toHaveBeenCalledWith(selection)
    const render = {
      ...selection,
      composition,
      codec: "h264" as const,
      outputLocation: "/output.mp4",
      concurrency: 2,
      offthreadVideoCacheSizeInBytes: 1024,
      onProgress: vi.fn(),
    }
    await engine.renderMedia(render)
    expect(adapter.renderMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        composition,
        serveUrl: "/bundle",
        codec: "h264",
        outputLocation: "/output.mp4",
        inputProps: selection.inputProps,
        puppeteerInstance: browser,
        concurrency: 2,
        offthreadVideoCacheSizeInBytes: 1024,
        timeoutInMilliseconds: 7500,
        onProgress: render.onProgress,
      }),
    )
  })

  it("propagates render rejection so devotional execution can close its browser", async () => {
    const failure = new Error("codec unavailable")
    adapter.renderMedia.mockRejectedValue(failure)
    await expect(
      createDefaultRenderEngine().renderMedia({
        composition: {
          id: "Devotional",
          width: 1080,
          height: 1920,
          fps: 30,
          durationInFrames: 30,
        },
        serveUrl: "/bundle",
        codec: "h264",
        outputLocation: "/output.mp4",
        inputProps: {},
        puppeteerInstance: { close: vi.fn(async () => {}) },
        concurrency: 1,
        offthreadVideoCacheSizeInBytes: 1024,
        timeoutInMilliseconds: 1000,
        onProgress: vi.fn(),
      }),
    ).rejects.toBe(failure)
  })
})
