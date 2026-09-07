import { createReadStream } from "node:fs"
import { execFileSync } from "node:child_process"
import { readFile as read, stat, readdir } from "node:fs/promises"
import { createServer } from "node:http"
import { pipeline } from "node:stream/promises"
import { resolve } from "node:path"
const { selectComposition, renderMedia } = await import("/runtime/renderer.cjs")
const input = JSON.parse(await read("/input/input.json", "utf8"))
const served = new Map()
let sourceIndex = 0
for (const media of Object.values(input.media)) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(media.file))
    throw new Error("Invalid retained media filename")
  if (media.kind !== "hls") {
    served.set(media.file, resolve("/input", media.file))
    continue
  }
  // Remotion downloads an HLS playlist without its relative segments. Remux
  // admitted local bytes before executing any composition code. The private
  // namespace has no external network, and FFmpeg permits only local files.
  const playlist = await read(resolve("/input", media.file), "utf8")
  if (playlist.length > 262144 || !playlist.startsWith("#EXTM3U\n") ||
      !playlist.includes("#EXT-X-ENDLIST")) throw new Error("Invalid retained HLS")
  for (const raw of playlist.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith("#")) {
      if (!/^#(?:EXTM3U|EXTINF:|EXT-X-(?:VERSION:|TARGETDURATION:|MEDIA-SEQUENCE:|PLAYLIST-TYPE:|ENDLIST$|DISCONTINUITY$|INDEPENDENT-SEGMENTS$))/.test(line) || line.includes("URI="))
        throw new Error("Unsupported retained HLS directive")
    } else if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(line)) {
      throw new Error("HLS must reference admitted local segment names")
    }
  }
  const name = `studio-source-${sourceIndex++}.mp4`
  const output = resolve("/tmp", name)
  execFileSync("/codec/ffmpeg", ["-v", "error", "-xerror", "-nostdin",
    "-protocol_whitelist", "file", "-i", resolve("/input", media.file),
    "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", output],
    {timeout: 30000, maxBuffer: 65536})
  media.file = name
  served.set(name, output)
}
const server = createServer((req, res) => {
  const name = (req.url ?? "").slice(1)
  if (!/^[a-zA-Z0-9._-]{1,160}$/.test(name)) {
    res.writeHead(404).end()
    return
  }
  const file = served.get(name)
  if (!file) { res.writeHead(404).end(); return }
  res.setHeader("Access-Control-Allow-Origin", "*")
  const stream = createReadStream(file)
  stream.on("error", () => res.writeHead(404).end())
  stream.pipe(res)
})
await new Promise((done) => server.listen(0, "127.0.0.1", done))
try {
  const options = {
    serveUrl: "/bundle",
    inputProps: {
      input,
      mode: "render",
      mediaBaseUrl: `http://127.0.0.1:${server.address().port}/`,
    },
    browserExecutable: "/browser/chrome-headless-shell",
    timeoutInMilliseconds: 7000,
    logLevel: "error",
  }
  const composition = await selectComposition({ ...options, id: "Studio" })
  await renderMedia({
    ...options,
    composition,
    onProgress: ({renderedFrames}) => {if(renderedFrames%300===0)console.error("RENDER_PROGRESS",renderedFrames)},
    codec: "h264",
    ffmpegOverride: ({args}) => ["-threads","1","-filter_threads","1","-filter_complex_threads","1",...args.slice(0,-1),"-threads","1",args.at(-1)],
    audioCodec: "aac",
    enforceAudioTrack: true,
    audioSampleRate: 48000,
    concurrency: 1,
    outputLocation: "/tmp/output.mp4",
    offthreadVideoCacheSizeInBytes: 33554432,
    offthreadVideoThreads: 1,
  })
  const size = (await stat("/tmp/output.mp4")).size
  if (size < 1 || size > 134217728) throw new Error("Output size rejected")
  await pipeline(createReadStream("/tmp/output.mp4"), process.stdout)
} finally {
  server.closeAllConnections()
  server.close()
}
