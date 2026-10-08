/* global document */
/* eslint-disable @typescript-eslint/no-require-imports */
const { Buffer } = require("node:buffer")
const fs = require("node:fs")
const path = require("node:path")
const { createRequire } = require("node:module")
const { pathToFileURL } = require("node:url")
const dependencies = process.env.LOGO_RENDER_NODE_MODULES
  ? createRequire(
      path.join(process.env.LOGO_RENDER_NODE_MODULES, "package.json"),
    )
  : require
const { chromium } = dependencies("playwright")
const sharp = dependencies("sharp")

async function render() {
  const output = path.join(__dirname, "../assets/logo-motion")
  fs.mkdirSync(output, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: "chrome" })
  try {
    for (let effect = 0; effect < 10; effect++) {
      const page = await browser.newPage({
        viewport: { width: 768, height: 512 },
        deviceScaleFactor: 1,
      })
      await page.goto(
        pathToFileURL(path.join(__dirname, "logo-motion-source.html")).href,
      )
      await page.evaluate((index) => {
        const svg = document.querySelectorAll(".gallery svg.motion")[index]
        document.body.replaceChildren(svg)
        const style = document.createElement("style")
        style.textContent =
          "html,body{background:transparent!important;margin:0}svg.motion{display:block;width:768px;height:512px}"
        document.head.append(style)
        for (const animation of document.getAnimations()) animation.pause()
      }, effect)
      const frames = []
      for (let frame = 0; frame < 90; frame++) {
        await page.evaluate(
          (time) => {
            for (const animation of document.getAnimations())
              animation.currentTime = time
          },
          (frame * 1000) / 15,
        )
        const png = await page.screenshot({ omitBackground: true })
        frames.push(await sharp(png).ensureAlpha().raw().toBuffer())
      }
      const filename = path.join(
        output,
        `${String(effect + 1).padStart(2, "0")}.webp`,
      )
      await sharp(Buffer.concat(frames), {
        raw: { width: 768, height: 512 * 90, pageHeight: 512, channels: 4 },
      })
        .webp({ quality: 86, effort: 3, loop: 0, delay: Array(90).fill(67) })
        .toFile(filename)
      console.log(path.basename(filename), fs.statSync(filename).size)
      if (effect === 2) {
        await page.evaluate(() => {
          document.querySelector("svg.motion").innerHTML =
            '<path fill="#ef3340" d="M45.854 -.000301361H2.34C1.048 -.000301361 0 1.0467 0 2.3397V20.2427C0 21.2917 .699 22.2137 1.709 22.4957L47.072 35.2077C47.636 35.3657 48.194 34.9417 48.194 34.3567V2.3397C48.194 1.0467 47.147 -.000301361 45.854 -.000301361Z" transform="translate(24,14)"/>'
        })
        await page.screenshot({
          path: path.join(output, "static.png"),
          omitBackground: true,
        })
      }
      await page.close()
    }
  } finally {
    await browser.close()
  }
}

render().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
