import { createRequire } from "node:module"
const { cleanDownloadMap } = createRequire(
  await realpath("/runtime/renderer.cjs"),
)("./assets/download-map.js")
import { readFile, realpath, writeFile } from "node:fs/promises"
process.env.FORGE_STUDIO_CODEC_THREADS = "1"
process.env.DISABLE_FROM_SURFACE = "1"
const { renderFrames, openBrowser } = await import("/runtime/renderer.cjs")
const options = JSON.parse(await readFile("/tmp/render-options.json", "utf8"))
const browser = await openBrowser("chrome", {
  browserExecutable: options.browserExecutable,
  logLevel: "error",
  chromiumOptions: { gl: "swangle" },
})
let active = false
let stopping = false
process.on("message", async (message) => {
  try {
    if (message.stop) {
      stopping = true
      await browser.close({ silent: true })
      process.disconnect()
      return
    }
    if (active) throw Error("Overlapping frame chunk")
    active = true
    const { index, start, end } = message
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end >= options.composition.durationInFrames
    )
      throw Error("Invalid frame chunk")
    const result = await renderFrames({
      ...options,
      puppeteerInstance: browser,
      concurrency: 1,
      muted: false,
      imageFormat: "jpeg",
      jpegQuality: 80,
      frameRange: [start, end],
      outputDir: "/tmp/frames/" + index,
      offthreadVideoCacheSizeInBytes: 33554432,
      offthreadVideoThreads: 1,
    })
    await writeFile(
      "/tmp/frames/" + index + "/assets.json",
      JSON.stringify(result.assetsInfo.assets),
    )
    cleanDownloadMap(result.assetsInfo.downloadMap)
    active = false
    process.send({ index })
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
})
process.on("disconnect", () => process.exit(stopping ? 0 : 1))
process.send({ ready: true })
