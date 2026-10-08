import { createRequire } from "node:module"
import { resolve } from "node:path"
const require = createRequire(resolve(".tmp/browser-tools/package.json"))
const { chromium } = require("playwright")
const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox"],
})
const samples = { baseline: [], candidate: [] }
for (let i = 0; i < 6; i++) {
  for (const name of i % 2
    ? ["candidate", "baseline"]
    : ["baseline", "candidate"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    })
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${name === "baseline" ? 4181 : 4180}`)
    await page.waitForSelector('[data-preview-ready="true"]')
    await page.waitForFunction(() =>
      [...document.querySelectorAll("video")].some((v) => v.readyState >= 2),
    )
    samples[name].push(
      await page.evaluate(() => ({
        ready: performance.now(),
        dcl: performance.getEntriesByType("navigation")[0]
          .domContentLoadedEventEnd,
        js: performance
          .getEntriesByType("resource")
          .filter((r) => r.initiatorType === "script")
          .reduce((n, r) => n + r.transferSize, 0),
      })),
    )
    await context.close()
  }
}
const median = (values) => {
  values.sort((a, b) => a - b)
  return (values[2] + values[3]) / 2
}
console.log(
  JSON.stringify(
    {
      medians: Object.fromEntries(
        Object.entries(samples).map(([name, values]) => [
          name,
          {
            ready: median(values.map((v) => v.ready)),
            dcl: median(values.map((v) => v.dcl)),
            js: median(values.map((v) => v.js)),
          },
        ]),
      ),
      samples,
    },
    null,
    2,
  ),
)
await browser.close()
