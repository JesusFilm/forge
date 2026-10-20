import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { Writable } from "node:stream"
import test from "node:test"
import { compileFunction } from "node:vm"

const require = createRequire(new URL("../package.json", import.meta.url))
const root = path.dirname(require.resolve("@remotion/renderer"))
const esm = await readFile(path.join(root, "esm/index.mjs"), "utf8")
const cjs = await readFile(path.join(root, "render-media.js"), "utf8")

async function memoryDecision(format, env) {
  if (format === "esm") {
    const source = esm
      .split("// src/prestitcher-memory-usage.ts\n")[1]
      .split("// src/prores-profile.ts")[0]
    return compileFunction(source + "\nreturn shouldUseParallelEncoding", [
      "process",
      "getAvailableMemory",
    ])({ env }, () => 2147483648)
  }
  const filename = path.join(root, "prestitcher-memory-usage.js")
  const source = await readFile(filename, "utf8")
  const module = { exports: {} }
  compileFunction(source, ["require", "module", "exports", "process"])(
    () => ({ getAvailableMemory: () => 2147483648 }),
    module,
    module.exports,
    { env },
  )
  return module.exports.shouldUseParallelEncoding
}

async function frameProducer(format, enabled = true) {
  const filename = path.join(root, "render-frame-with-option-to-reject.js")
  const localRequire = createRequire(filename)
  const boundaries = {
    "./error-handling/handle-javascript-exception": {
      handleJavascriptException: () => () => {},
    },
    "./seek-to-frame": { seekToFrame: async () => {} },
    "./take-frame": { takeFrame: async () => Buffer.alloc(1024) },
    "./collect-assets": { collectAssets: async () => [] },
  }
  if (format === "cjs") {
    const module = { exports: {} }
    compileFunction(await readFile(filename, "utf8"), [
      "require",
      "module",
      "exports",
      "process",
    ])((id) => boundaries[id] ?? localRequire(id), module, module.exports, {
      env: enabled
        ? { FORGE_STUDIO_STREAM_FRAMES: "1", FORGE_STUDIO_CODEC_THREADS: "1" }
        : {},
    })
    return module.exports.renderFrameWithOptionToReject
  }
  const start = esm.indexOf("var renderFrameWithOptionToReject =")
  const source = esm.slice(start, esm.indexOf("\n// src/", start))
  const dependencies = {
    handleJavascriptException:
      boundaries["./error-handling/handle-javascript-exception"]
        .handleJavascriptException,
    seekToFrame: boundaries["./seek-to-frame"].seekToFrame,
    takeFrame: boundaries["./take-frame"].takeFrame,
    collectAssets: boundaries["./collect-assets"].collectAssets,
    path21: path,
    getFrameOutputFileName: localRequire("./get-frame-padded-index")
      .getFrameOutputFileName,
    Log: { verbose() {} },
    truthy: Boolean,
    ...localRequire("./filter-asset-types"),
    ...localRequire("./compress-assets"),
    ...localRequire("./assets/download-and-map-assets-to-file"),
    forgeBoundedFrameStreaming: enabled,
  }
  return compileFunction(
    source + "\nreturn renderFrameWithOptionToReject",
    Object.keys(dependencies),
  )(...Object.values(dependencies))
}

function frameOptions(onFrameBuffer, count, frame = 0) {
  return {
    reject(error) {
      throw error
    },
    width: 1080,
    height: 1920,
    compId: "Studio",
    attempt: 0,
    stoppedSignal: { stopped: false },
    indent: false,
    logLevel: "error",
    timeoutInMilliseconds: 7000,
    outputDir: null,
    onFrameBuffer,
    imageFormat: "jpeg",
    lastFrame: 8855,
    frameDir: "/fixture",
    scale: 1,
    countType: "from-zero",
    assets: [],
    framesToRender: [0, 1],
    framesRenderedObj: count,
    frame,
    page: { on() {}, off() {} },
    fps: 30,
    allFramesAndExtraFrames: [0, 1],
  }
}

for (const format of ["cjs", "esm"]) {
  test(`${format}: other SDK consumers preserve their existing callback behavior`, async () => {
    const produce = await frameProducer(format, false)
    let release
    const buffered = new Promise((resolve) => {
      release = resolve
    })
    const count = { count: 0 }
    await produce(frameOptions(() => buffered, count))
    assert.equal(count.count, 1)
    release()
    await buffered
  })
  test(`${format}: contained streaming opts in before import without changing other consumers`, async () => {
    const dimensions = { width: 1080, height: 1920, logLevel: "error" }
    for (const env of [
      {},
      { FORGE_STUDIO_STREAM_FRAMES: "1" },
      { FORGE_STUDIO_CODEC_THREADS: "1" },
    ]) {
      const decide = await memoryDecision(format, env)
      assert.equal(decide(dimensions).hasEnoughMemory, false)
      env.FORGE_STUDIO_STREAM_FRAMES = "1"
      env.FORGE_STUDIO_CODEC_THREADS = "1"
      assert.equal(decide(dimensions).hasEnoughMemory, false)
    }
    const decide = await memoryDecision(format, {
      FORGE_STUDIO_STREAM_FRAMES: "1",
      FORGE_STUDIO_CODEC_THREADS: "1",
    })
    assert.equal(decide(dimensions).hasEnoughMemory, true)
  })

  // Execute the installed SDK producer AND its actual frame callback. Browser
  // seek/screenshot and encoder writes are external boundaries.
  function callback(stream, advanced, cancelled = false) {
    const source = format === "cjs" ? cjs : esm
    const expression = source.match(
      /onFrameBuffer:\s*parallelEncoding\s*\?\s*(async[\s\S]*?)\s*:\s*null,/,
    )?.[1]
    assert.ok(expression, "Pinned SDK frame callback must remain identifiable")
    return compileFunction(`return (${expression})`, [
      "waitForRightTimeOfFrameToBeInserted",
      "cancelled",
      "perf_1",
      "preStitcher",
      "stitcherFfmpeg",
      "setFrameToStitch",
      "realFrameRange",
      "everyNthFrame",
      "startPerfMeasure",
      "stopPerfMeasure",
      "forgeBoundedFrameStreaming",
    ])(
      async () => {},
      cancelled,
      { startPerfMeasure: () => 0, stopPerfMeasure() {} },
      { getExitStatus: () => ({ type: "running" }) },
      { stdin: stream },
      (frame) => advanced.push(frame),
      [0, 8855],
      1,
      () => 0,
      () => {},
      true,
    )
  }

  test(`${format}: a slow encoder applies frame backpressure and write errors reject`, async () => {
    let flush
    const stream = new Writable({
      highWaterMark: 1,
      write(_bytes, _encoding, done) {
        flush = done
      },
    })
    stream.on("error", () => {})
    const advanced = []
    const frame = callback(stream, advanced)
    const produce = await frameProducer(format)
    const count = { count: 0 }
    const pending = produce(frameOptions(frame, count))
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(advanced, [])
    assert.equal(
      count.count,
      0,
      "Producer must not release its page before the encoder write",
    )
    assert.equal(stream.writableLength, 1024)
    flush()
    await pending
    assert.deepEqual(advanced, [1])
    assert.equal(count.count, 1)

    const failed = produce(frameOptions(frame, count, 1))
    const rejected = assert.rejects(failed, /encoder stopped/)
    await new Promise((resolve) => setImmediate(resolve))
    flush(new Error("encoder stopped"))
    await rejected
    assert.deepEqual(advanced, [1])
    assert.equal(count.count, 1)
  })

  test(`${format}: cancellation and missing encoder cannot silently advance frames`, async () => {
    const advanced = []
    const stream = new Writable({
      write: () => assert.fail("Unexpected write"),
    })
    await callback(stream, advanced, true)(Buffer.alloc(1), 0)
    assert.deepEqual(advanced, [])
    const produce = await frameProducer(format)
    const count = { count: 0 }
    await assert.rejects(produce(frameOptions(callback(null, advanced), count)))
    assert.equal(count.count, 0)
    assert.deepEqual(advanced, [])
    stream.destroy()
  })
}
