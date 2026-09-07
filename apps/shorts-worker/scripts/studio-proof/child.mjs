import { performance } from "node:perf_hooks"
// Executes only inside the empty network/filesystem namespace.
import { readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { createReadStream } from "node:fs"
const { selectComposition, renderMedia, renderStill } = await import(
  process.argv[2]
)
const input = JSON.parse(await readFile("/job/input.json", "utf8"))
const server = createServer((req, res) => {
  if (req.url !== "/source.mp4") {
    res.writeHead(404).end()
    return
  }
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Content-Type", "video/mp4")
  createReadStream("/job/source.mp4").pipe(res)
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const started = performance.now()
try {
  const inputProps = {
    manifest: input.manifest,
    mediaUrl: input.noMedia
      ? ""
      : `http://127.0.0.1:${server.address().port}/source.mp4`,
    preview: false,
  }
  const options = {
    serveUrl: "/job/bundle",
    inputProps,
    browserExecutable: "/browser/chrome-headless-shell",
    timeoutInMilliseconds: 7000,
  }
  const composition = await selectComposition({ ...options, id: "StudioProof" })
  await renderMedia({
    ...options,
    composition,
    codec: "h264",
    concurrency: 1,
    outputLocation: "/job/output.mp4",
    offthreadVideoCacheSizeInBytes: 32 * 1024 * 1024,
    offthreadVideoThreads: 1,
  })
  const exportMs = performance.now() - started
  for (const frame of [0, 24, 25, 45])
    await renderStill({
      ...options,
      composition,
      frame,
      output: `/job/frame-${frame}.png`,
    })
  await writeFile(
    "/job/result.json",
    JSON.stringify({
      exportMs,
      frames: composition.durationInFrames,
      environmentKeys: Object.keys(process.env).sort(),
    }),
  )
} finally {
  server.closeAllConnections()
  server.close()
}
