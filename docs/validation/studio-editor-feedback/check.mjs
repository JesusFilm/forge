import { createRequire } from "node:module"
import { resolve } from "node:path"
import { mkdir } from "node:fs/promises"
const require = createRequire(resolve(".tmp/browser-tools/package.json"))
const { chromium } = require("playwright")
const url = process.argv[2] ?? "http://127.0.0.1:4180"
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox"],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
let previewRequests = 0
page.on("request", (request) => {
  if (new URL(request.url()).pathname === "/api/shorts/preview")
    previewRequests++
})
const checks = {}
const samples = []
const center = async (text) =>
  page
    .locator(".nle-preview span")
    .filter({ hasText: new RegExp(`^${text}$`) })
    .evaluate((element) => {
      const r = element.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
try {
  for (let run = 0; run < 5; run++) {
    await page.goto(url)
    await page.waitForSelector('[data-preview-ready="true"]')
    await page.waitForFunction(() =>
      [...document.querySelectorAll("video")].some((v) => v.readyState >= 2),
    )
    samples.push(
      await page.evaluate(() => ({
        readyMs: performance.now(),
        domContentLoadedMs:
          performance.getEntriesByType("navigation")[0]
            .domContentLoadedEventEnd,
        scriptBytes: performance
          .getEntriesByType("resource")
          .filter((r) => r.initiatorType === "script")
          .reduce((n, r) => n + r.transferSize, 0),
      })),
    )
  }
  checks.fullHeight = await page.evaluate(
    () =>
      Math.abs(
        document.querySelector(".nle-canvas").getBoundingClientRect().height -
          document.querySelector(".nle-canvas-space").getBoundingClientRect()
            .height,
      ) < 2,
  )
  checks.componentName =
    (await page
      .getByRole("button", { name: "Caption timeline item", exact: true })
      .count()) === 1
  checks.textGroup =
    (await page
      .locator('[data-group="Text"]')
      .filter({ has: page.locator(".nle-clip-component") })
      .count()) > 0
  const position = await center("Caption")
  await page.mouse.click(position.x, position.y)
  checks.selectionDoesNotDirty =
    (await page.locator(".nle-save-status").innerText()) === "Saved · r1"
  checks.selectVisibleCaption =
    (await page.locator('.nle-clip-component[aria-pressed="true"]').count()) ===
    1
  await page.mouse.move(position.x, position.y)
  await page.mouse.down()
  await page.mouse.move(position.x + 35, position.y - 20, { steps: 8 })
  const live = await center("Caption")
  checks.liveDrag =
    Math.abs(live.x - position.x - 35) < 2 &&
    Math.abs(live.y - position.y + 20) < 2
  await page.mouse.up()
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await page.waitForFunction(() => window.fixtureStored().revision >= 2)
  const stored = await page.evaluate(() => window.fixtureStored())
  const canvasWidth = await page
    .locator(".nle-canvas")
    .evaluate((e) => e.getBoundingClientRect().width)
  const caption = stored.document.items.find((i) => i.id === "caption")
  checks.persistDrag =
    Math.abs((caption.transform?.x ?? 0) - (35 * 1080) / canvasWidth) < 1
  checks.otherLayerUnchanged =
    stored.document.items.find((i) => i.id === "credit").transform.y === 550
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  const undone = await center("Caption")
  checks.undo = Math.abs(undone.x - position.x) < 2
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await page.reload()
  await page.waitForSelector('[data-preview-ready="true"]')
  checks.reopen = Math.abs((await center("Caption")).x - live.x) < 2
  if (checks.selectVisibleCaption) {
    await page
      .getByRole("button", { name: "Caption timeline item", exact: true })
      .click()
    const beforeCancel = await center("Caption")
    await page.mouse.move(beforeCancel.x, beforeCancel.y)
    await page.mouse.down()
    await page.mouse.move(beforeCancel.x + 15, beforeCancel.y + 10, {
      steps: 4,
    })
    await page
      .locator(".nle-canvas-overlay")
      .dispatchEvent("pointercancel", { pointerId: 1 })
    await page.mouse.up()
    const canceled = await center("Caption")
    checks.cancelRestoresPosition =
      Math.abs(canceled.x - beforeCancel.x) < 2 &&
      Math.abs(canceled.y - beforeCancel.y) < 2
  }
  if (checks.componentName) {
    await page
      .getByRole("button", { name: "Caption timeline item", exact: true })
      .click()
    const before = previewRequests
    await page
      .getByLabel("Component name", { exact: true })
      .fill("Devotional caption")
    await page.getByLabel("Component name", { exact: true }).press("Tab")
    checks.rename =
      (await page
        .getByRole("button", {
          name: "Devotional caption timeline item",
          exact: true,
        })
        .count()) === 1
    await page
      .getByLabel("Timeline section", { exact: true })
      .selectOption("video")
    checks.explicitVideoGroup =
      (await page
        .locator('[data-group="Video"]')
        .filter({ has: page.locator(".nle-clip-component") })
        .count()) > 0
    await page
      .getByLabel("Timeline section", { exact: true })
      .selectOption("text")
    await page.waitForTimeout(100)
    checks.metadataKeepsPreview = previewRequests === before
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await page.waitForFunction(
      () =>
        window.fixtureStored().document.components[0].name ===
        "Devotional caption",
    )
    await page.reload()
    await page.waitForSelector('[data-preview-ready="true"]')
    checks.renameReopen =
      (await page
        .getByRole("button", {
          name: "Devotional caption timeline item",
          exact: true,
        })
        .count()) === 1
  }
  await page
    .getByRole("button", { name: "Source footage timeline item", exact: true })
    .click()
  const speed = page.getByLabel("Clip speed", { exact: true })
  checks.speedControl = (await speed.count()) === 1
  if (checks.speedControl) {
    await speed.fill("0.5")
    await speed.press("Enter")
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await page.waitForFunction(
      () => window.fixtureStored().document.items[0].playbackRate === 0.5,
    )
    const slow = await page.evaluate(() => window.fixtureStored().document)
    checks.speedDuration =
      slow.items[0].durationInFrames === 600 &&
      slow.durationInFrames === 600 &&
      slow.items[0].source.endMs === 10000
    await page.getByRole("button", { name: "Play", exact: true }).click()
    await page.waitForTimeout(800)
    checks.previewRate = await page
      .locator("video")
      .first()
      .evaluate((v) => v.playbackRate === 0.5)
    await page.getByRole("button", { name: "Pause", exact: true }).click()
  }
  if (checks.speedControl) {
    const clip = page.getByRole("button", {
      name: "Source footage timeline item",
      exact: true,
    })
    const clipRect = await clip.boundingBox()
    const trim = await clip.locator(".nle-trim.left").boundingBox()
    const dx = clipRect.width / 10
    await page.mouse.move(trim.x + trim.width / 2, trim.y + trim.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      trim.x + trim.width / 2 + dx,
      trim.y + trim.height / 2,
      { steps: 10 },
    )
    await page.mouse.up()
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await page.waitForFunction(
      () => window.fixtureStored().document.items[0].source.startMs > 0,
    )
    const trimmed = await page.evaluate(
      () => window.fixtureStored().document.items[0],
    )
    checks.slowTimelineTrim =
      trimmed.startFrame === 60 &&
      trimmed.durationInFrames === 540 &&
      trimmed.source.startMs === 1000 &&
      trimmed.source.endMs === 10000
  }
  checks.noUnhandledErrors = errors.length === 0
  await mkdir(".tmp/studio-editor-feedback", { recursive: true })
  await page.screenshot({ path: ".tmp/studio-editor-feedback/check.png" })
} finally {
  console.log(JSON.stringify({ url, checks, errors, samples }, null, 2))
  await browser.close()
}
if (Object.values(checks).some((value) => !value)) process.exitCode = 1
