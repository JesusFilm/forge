import { setTimeout, clearTimeout } from "node:timers"
import { createRequire } from "node:module"
import { fork, spawn } from "node:child_process"
import {
  readFile,
  writeFile,
  readdir,
  unlink,
  rmdir,
  mkdir,
  realpath,
  stat,
} from "node:fs/promises"
import { once } from "node:events"
import { renderOrderedFrames } from "./frame-pool.mjs"

const CHUNK_FRAMES = 60
const FRAME_WORKERS = 16

function exitOf(child) {
  const result = new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`Render subprocess exited ${code ?? signal}`)),
    )
  })
  result.catch(() => {})
  return result
}

function frameWorker() {
  const child = fork("/runtime/frame-worker.mjs", [], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    execArgv: ["--max-old-space-size=256"],
  })
  let request,
    closing = false
  let rejectFailure
  const failed = new Promise((_, reject) => {
    rejectFailure = reject
  })
  failed.catch(() => {})
  const fail = (error) => {
    rejectFailure(error)
    if (request) {
      request.reject(error)
      request = null
    }
  }
  child.on("error", fail)
  child.on("exit", (code) => {
    if (!closing || code !== 0)
      fail(new Error("Frame worker exited before completion"))
  })
  child.on("message", (message) => {
    if (
      !request ||
      !(request.index === null
        ? message?.ready === true
        : message?.index === request.index)
    ) {
      fail(new Error("Unexpected frame worker response"))
      return
    }
    request.resolve()
    request = null
  })
  const ready = new Promise((resolve, reject) => {
    request = { index: null, resolve, reject }
  })
  ready.catch(() => {})
  return {
    ready,
    failed,
    render(range) {
      if (
        closing ||
        request ||
        child.exitCode !== null ||
        child.signalCode !== null
      )
        return Promise.reject(new Error("Frame worker is unavailable"))
      return new Promise((resolve, reject) => {
        request = { index: range.index, resolve, reject }
        child.send(range, (error) => {
          if (error) fail(error)
        })
      })
    },
    async close(abort) {
      closing = true
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = once(child, "exit")
      let forced = false
      const timer = setTimeout(() => {
        forced = true
        child.kill("SIGKILL")
      }, 5000)
      try {
        if (abort) child.kill("SIGKILL")
        else
          child.send({ stop: true }, (error) => {
            if (error) child.kill("SIGKILL")
          })
        const [code] = await exited
        if (!abort && (forced || code !== 0))
          throw new Error("Frame worker cleanup failed")
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/** Fixed pool, bounded ordered lookahead, one continuous H.264/AAC timeline. */
export async function parallelRender(options) {
  const started = Date.now()
  const {
    composition,
    serveUrl,
    inputProps,
    browserExecutable,
    timeoutInMilliseconds,
    logLevel,
  } = options
  const total = composition.durationInFrames
  await writeFile(
    "/tmp/render-options.json",
    JSON.stringify({
      composition,
      serveUrl,
      inputProps,
      browserExecutable,
      timeoutInMilliseconds,
      logLevel,
    }),
  )
  await mkdir("/tmp/frames")
  const encoder = spawn(
    "/codec/ffmpeg",
    [
      "-v",
      "error",
      "-xerror",
      "-nostdin",
      "-filter_threads",
      "1",
      "-filter_complex_threads",
      "1",
      "-r",
      String(composition.fps),
      "-f",
      "image2pipe",
      "-s",
      `${composition.width}x${composition.height}`,
      "-vcodec",
      "mjpeg",
      "-threads",
      "1",
      "-i",
      "-",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "veryfast",
      "-video_track_timescale",
      "90000",
      "-b:v",
      options.videoBitrate,
      "-bufsize",
      options.encodingBufferSize,
      "-maxrate",
      options.encodingMaxRate,
      "-threads",
      "8",
      "-y",
      "/tmp/video.mp4",
    ],
    { stdio: ["pipe", "ignore", "inherit"] },
  )
  const encoded = exitOf(encoder)
  let rejectEncoder
  const encoderFailure = new Promise((_, reject) => {
    rejectEncoder = reject
  })
  encoderFailure.catch(() => {})
  encoded.catch(rejectEncoder)
  encoder.stdin.on("error", rejectEncoder)
  const assets = []
  try {
    const { stitchFramesToVideo } = await import("/runtime/renderer.cjs")
    const { makeDownloadMap, cleanDownloadMap } = createRequire(
      await realpath("/runtime/renderer.cjs"),
    )("./assets/download-map.js")
    await renderOrderedFrames({
      durationInFrames: total,
      workerCount: FRAME_WORKERS,
      chunkFrames: CHUNK_FRAMES,
      failure: encoderFailure,
      createWorker: frameWorker,
      async consume({ index, start, end }) {
        const dir = `/tmp/frames/${index}`
        if ((await stat(`${dir}/assets.json`)).size > 64 * 1024 * 1024)
          throw new Error("Oversized frame metadata")
        const metadata = JSON.parse(
          await readFile(`${dir}/assets.json`, "utf8"),
        )
        if (
          !Array.isArray(metadata) ||
          metadata.length !== end - start + 1 ||
          metadata.some((frame, offset) => frame.frame !== start + offset)
        )
          throw new Error("Invalid audio frame metadata")
        assets.push(...metadata)
        await unlink(`${dir}/assets.json`)
        const names = (await readdir(dir)).sort(
          (a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]),
        )
        if (names.length !== end - start + 1)
          throw new Error("Incomplete frame chunk")
        for (let offset = 0; offset < names.length; offset++) {
          const name = names[offset]
          if (
            !/^element-\d+\.jpeg$/.test(name) ||
            Number(name.match(/\d+/)[0]) !== start + offset
          )
            throw new Error("Unexpected frame inventory")
          if ((await stat(`${dir}/${name}`)).size > 16777216)
            throw new Error("Oversized frame")
          const bytes = await readFile(`${dir}/${name}`)
          if (!encoder.stdin.write(bytes))
            await Promise.race([once(encoder.stdin, "drain"), encoderFailure])
          await unlink(`${dir}/${name}`)
        }
        await rmdir(dir)
        if (index % 10 === 0)
          console.error(
            JSON.stringify({
              frames: end + 1,
              elapsedMs: Date.now() - started,
            }),
          )
        if (end !== total - 1) return
        encoder.stdin.end()
        await encoded
        // Stitch once from every frame's ordered metadata. Per-chunk AAC would
        // introduce repeated priming/trimming at range boundaries.
        const downloadMap = makeDownloadMap(48000)
        try {
          await stitchFramesToVideo({
            assetsInfo: {
              assets,
              imageSequenceName: "/tmp/none-%05d.none",
              firstFrameIndex: 0,
              downloadMap,
              chunkLengthInSeconds: total / composition.fps,
              trimLeftOffset: 0,
              trimRightOffset: 0,
              forSeamlessAacConcatenation: false,
            },
            fps: composition.fps,
            width: composition.width,
            height: composition.height,
            codec: "aac",
            audioCodec: "aac",
            audioBitrate: "320k",
            sampleRate: 48000,
            enforceAudioTrack: true,
            ffmpegOverride: options.ffmpegOverride,
            outputLocation: "/tmp/audio.m4a",
          })
        } finally {
          cleanDownloadMap(downloadMap)
        }
      },
    })
    const mux = spawn(
      "/codec/ffmpeg",
      [
        "-v",
        "error",
        "-xerror",
        "-nostdin",
        "-i",
        "/tmp/video.mp4",
        "-i",
        "/tmp/audio.m4a",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        "-y",
        "/tmp/output.mp4",
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    )
    await exitOf(mux)
    console.error(
      JSON.stringify({ completeMs: Date.now() - started, frames: total }),
    )
  } finally {
    if (encoder.exitCode === null && encoder.signalCode === null) {
      encoder.kill("SIGKILL")
      await encoded.catch(() => {})
    }
  }
}
