import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import test from "node:test"
import { compileFunction } from "node:vm"

const require = createRequire(new URL("../package.json", import.meta.url))
const filename = path.join(
  path.dirname(require.resolve("@remotion/renderer")),
  "render-frames.js",
)

// Execute the installed SDK's real render lifecycle and crash-replacement owner.
// Browser startup, a frame crash and HTTP serving are the external boundaries.
async function renderWithBrowserRecovery({
  supplied = false,
  crash = true,
} = {}) {
  const closes = []
  const original = { close: async () => closes.push("original") }
  const replacement = { close: async () => closes.push("replacement") }
  let starts = 0
  let recovered = false
  const localRequire = createRequire(filename)
  const boundaries = {
    "./open-browser": {
      internalOpenBrowser: async () =>
        ++starts === 1 ? original : replacement,
    },
    "./prepare-server": {
      makeOrReuseServer: async () => ({
        server: {
          serveUrl: "http://fixture.invalid",
          offthreadPort: 1,
          sourceMap: {},
          downloadMap: { compositingDir: "/fixture" },
        },
        cleanupServer: async () => {},
      }),
    },
    "./cycle-browser-tabs": { cycleBrowserTabs: () => ({ stopCycling() {} }) },
    "./make-page": { makePage: async () => ({ close: async () => {} }) },
    "./render-frame-and-retry-target-close": {
      renderFrameAndRetryTargetClose: async ({
        browserReplacer,
        makeBrowser,
      }) => {
        if (!crash || recovered) return
        recovered = true
        await browserReplacer.replaceBrowser(makeBrowser, async () => {})
      },
    },
  }
  const module = { exports: {} }
  compileFunction(
    await readFile(filename, "utf8"),
    ["require", "module", "exports"],
    { filename },
  )((id) => boundaries[id] ?? localRequire(id), module, module.exports)
  await module.exports.renderFrames({
    composition: {
      id: "fixture",
      width: 16,
      height: 16,
      fps: 30,
      durationInFrames: 1,
      props: {},
    },
    concurrency: 1,
    serveUrl: "http://fixture.invalid",
    logLevel: "error",
    ...(supplied ? { puppeteerInstance: original } : {}),
  })
  // SDK cleanup intentionally follows the resolved render promise.
  await new Promise((resolve) => setImmediate(resolve))
  return { closes, starts, recovered }
}

test("successful render closes the replacement browser after recovering a crash", async () => {
  const result = await renderWithBrowserRecovery()
  assert.equal(result.recovered, true)
  assert.equal(result.starts, 2)
  assert.deepEqual(result.closes, ["original", "replacement"])
})

test("ordinary owned browser closes, while caller-owned browser stays open", async () => {
  assert.deepEqual((await renderWithBrowserRecovery({ crash: false })).closes, [
    "original",
  ])
  assert.deepEqual(
    (await renderWithBrowserRecovery({ supplied: true, crash: false })).closes,
    [],
  )
})
