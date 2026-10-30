import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { resolve } from "node:path"
const require = createRequire(resolve(".tmp/browser-tools/package.json"))
const { chromium } = require("playwright")
const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox"],
})
const url = process.argv[2] ?? "http://127.0.0.1:4180"
const checks = []
async function open() {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  })
  page.setDefaultTimeout(6000)
  await page.goto(url)
  await page.waitForSelector('[data-preview-ready="true"]')
  return page
}
async function removeAudio(page) {
  await page
    .getByRole("button", { name: "Audio timeline item", exact: true })
    .click()
  await page.getByRole("button", { name: "Delete item", exact: true }).click()
}
async function title(page, value) {
  const field = page.getByLabel("Title", { exact: true })
  await field.fill(value)
  await field.blur()
}
async function check(name, run) {
  await run()
  checks.push(name)
}
try {
  await check("audio deletion automatically persists and reopens", async () => {
    const page = await open()
    await page.waitForTimeout(1000)
    assert.equal(
      await page.evaluate(
        () => qa.commands().filter((c) => c.action === "apply").length,
      ),
      0,
    )
    await removeAudio(page)
    await page.waitForFunction(() => qa.stored().revision === 2, {
      timeout: 4000,
    })
    assert.equal(
      await page.evaluate(() =>
        qa.stored().document.items.some((i) => i.id === "ending"),
      ),
      false,
    )
    await page.reload()
    await page.waitForSelector('[data-preview-ready="true"]')
    assert.equal(
      await page
        .getByRole("button", { name: "Audio timeline item", exact: true })
        .count(),
      0,
    )
    await page.close()
  })
  await check(
    "preview session expiry warns without losing edits; sign-in and retry saves",
    async () => {
      const page = await open()
      await page.evaluate(() => qa.expire(true))
      await removeAudio(page)
      // Autosave reaches 401 even when no media remains to fetch for preview.
      await page.waitForFunction(
        () =>
          document.querySelector(".nle-save-status")?.textContent ===
          "Sign in required",
      )
      assert.match(
        await page.locator(".nle-notice").innerText(),
        /Your changes are not saved.*sign in again/,
      )
      assert.equal(
        await page.locator(".nle-notice a").getAttribute("target"),
        "_blank",
      )
      await title(page, "Still editing while expired")
      assert.match(
        await page.locator(".nle-notice").innerText(),
        /sign in again/,
      )
      await page.waitForTimeout(1600)
      assert.equal(await page.evaluate(() => qa.stored().revision), 1)
      await page.evaluate(() => qa.expire(false))
      await page
        .getByRole("button", { name: "Retry save", exact: true })
        .click()
      await page.waitForFunction(
        () => qa.stored().document.title === "Still editing while expired",
      )
      assert.equal(
        await page.evaluate(() =>
          qa.stored().document.items.some((i) => i.id === "ending"),
        ),
        false,
      )
      await page.close()
    },
  )
  await check(
    "preview 401 reaches editor warning before save; separate sign-in link",
    async () => {
      const page = await open()
      await page.evaluate(() => qa.expire(true))
      await page
        .getByRole("button", { name: "Audio timeline item", exact: true })
        .click()
      await page
        .getByRole("button", { name: "Duplicate item", exact: true })
        .click()
      await page.waitForFunction(
        () =>
          document.querySelector(".nle-save-status")?.textContent ===
          "Sign in required",
      )
      assert.match(
        await page.locator(".nle-notice").innerText(),
        /Your changes are not saved/,
      )
      await page.waitForTimeout(1000)
      assert.equal(
        await page.evaluate(
          () => qa.commands().filter((c) => c.action === "apply").length,
        ),
        0,
      )
      await page.close({ runBeforeUnload: false })
    },
  )
  await check(
    "warns before link navigation and reload; recovery survives reload",
    async () => {
      const page = await open()
      await page.evaluate(() => qa.expire(true))
      await removeAudio(page)
      await page.waitForFunction(
        () =>
          document.querySelector(".nle-save-status")?.textContent ===
          "Sign in required",
      )
      let dialogs = []
      page.on("dialog", async (d) => {
        dialogs.push(d.type())
        await d.dismiss()
      })
      await page.getByTitle("Back to projects", { exact: true }).click()
      assert.deepEqual(dialogs, ["confirm"])
      assert.equal(new URL(page.url()).pathname, "/")
      // Browser unload uses a native warning and remains on page when canceled.
      await page.reload({ timeout: 1000 }).catch(() => {})
      assert.deepEqual(dialogs, ["confirm", "beforeunload"])
      page.removeAllListeners("dialog")
      page.on("dialog", (d) => d.accept())
      await page.reload()
      await page
        .getByRole("button", { name: "Retry save", exact: true })
        .click()
      await page.waitForFunction(() => qa.stored().revision === 2)
      assert.equal(
        await page.evaluate(() =>
          qa.stored().document.items.some((i) => i.id === "ending"),
        ),
        false,
      )
      await page.close()
    },
  )
  await check(
    "same-document browser Back is canceled while unsaved",
    async () => {
      const page = await open()
      await page.evaluate(() => {
        history.replaceState({}, "", "/prior")
        history.pushState({}, "", "/")
        qa.expire(true)
      })
      await removeAudio(page)
      await page.waitForFunction(
        () =>
          document.querySelector(".nle-save-status")?.textContent ===
          "Sign in required",
      )
      const dialog = page.waitForEvent("dialog")
      const back = page.goBack({ timeout: 1500 }).catch(() => {})
      const prompt = await dialog
      assert.equal(prompt.type(), "confirm")
      await prompt.dismiss()
      await back
      assert.equal(new URL(page.url()).pathname, "/")
      await page.close({ runBeforeUnload: false })
    },
  )
  await check(
    "editing during delayed save persists latest document in order",
    async () => {
      const page = await open()
      await page.evaluate(() => qa.delay(1000))
      await removeAudio(page)
      await page.waitForFunction(
        () =>
          document.querySelector(".nle-save-status")?.textContent === "Saving…",
      )
      await title(page, "Edit during save")
      await page.waitForFunction(() => qa.stored().revision === 3)
      assert.equal(
        await page.evaluate(() => qa.stored().document.title),
        "Edit during save",
      )
      await page.close()
    },
  )
  await check(
    "revision conflict pauses autosave without overwriting remote writer",
    async () => {
      const page = await open()
      await page.evaluate(() => qa.conflict())
      await removeAudio(page)
      await page.waitForSelector(".nle-conflict")
      await page.waitForTimeout(1600)
      assert.equal(
        await page.evaluate(() => qa.stored().document.title),
        "Remote writer",
      )
      assert.equal(
        await page.evaluate(
          () => qa.commands().filter((c) => c.action === "apply").length,
        ),
        1,
      )
      await page.close({ runBeforeUnload: false })
    },
  )
  console.log(JSON.stringify({ checks }, null, 2))
} finally {
  await browser.close()
}
