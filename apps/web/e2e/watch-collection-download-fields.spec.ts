import { expect, test, type Locator, type Page } from "@playwright/test"

// Layout regression for the collection download fields (PR 2836, feat-457).
// Run against an existing production or dev server; this spec never starts a
// server or seeds content. jsdom has no layout, so the class tests cannot see
// a select that is too narrow to show its value. This spec measures the real
// boxes and the painted text instead.
const path =
  process.env.WATCH_COLLECTION_DOWNLOAD_TEST_PATH ??
  "/watch/lumo-the-gospel-of-john.html/english.html"
if (process.env.WATCH_COLLECTION_DOWNLOAD_TEST_BASE_URL) {
  test.use({ baseURL: process.env.WATCH_COLLECTION_DOWNLOAD_TEST_BASE_URL })
}

const viewports = [
  { width: 320, height: 844 },
  { width: 639, height: 480 },
  { width: 640, height: 480 },
  { width: 641, height: 480 },
  { width: 736, height: 480 },
  { width: 768, height: 480 },
  { width: 864, height: 480 },
  { width: 900, height: 480 },
  { width: 1280, height: 800 },
]
// 32px root text stands in for 200% text. It is not browser zoom or an OS
// text setting: media queries still read the 16px initial font size.
const rootFonts = [16, 32]
const languages = ["Portuguese, Brazil", "Arabic, Modern Standard"]

type TextGeometry = {
  text: string
  ellipsis: boolean
  clippedInk: number
  brokenWords: string[]
}

// Measures one text element: whether it is cut by an ellipsis, how much of
// its glyph boxes falls outside the boxes that clip it, and which words are
// split across two lines.
async function measureText(text: Locator): Promise<TextGeometry> {
  return text.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const lines = [...range.getClientRects()].filter((r) => r.width > 0)
    let clippedInk = 0
    // Every box from the text up to its select button that hides overflow.
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (getComputedStyle(node).overflowX !== "visible") {
        const box = node.getBoundingClientRect()
        for (const line of lines) {
          clippedInk +=
            Math.max(0, box.left - line.left) +
            Math.max(0, line.right - box.right)
        }
      }
      if (node.matches("button")) break
    }
    const brokenWords: string[] = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      for (const match of node.textContent?.matchAll(/\S+/g) ?? []) {
        const word = document.createRange()
        const start = match.index ?? 0
        word.setStart(node, start)
        word.setEnd(node, start + match[0].length)
        const tops = new Set(
          [...word.getClientRects()].map((r) => Math.round(r.top)),
        )
        if (tops.size > 1) brokenWords.push(match[0])
      }
    }
    const style = getComputedStyle(element)
    return {
      text: element.textContent?.trim() ?? "",
      ellipsis:
        style.textOverflow === "ellipsis" &&
        element.scrollWidth > element.clientWidth + 1,
      clippedInk: Math.round(clippedInk),
      brokenWords,
    }
  })
}

async function openCollectionDownload(page: Page, rootFont: number) {
  // A production server only accepts the canonical origin as an auth
  // callback, so a loopback run gets a 400 here. The stub skips the account
  // check; the dialog layout under test does not depend on it.
  await page.route("**/watch/api/auth/session**", (route) =>
    route.fulfill({
      json: { accountGateEnabled: false, authenticated: false },
    }),
  )
  await page.goto(path)
  await page.evaluate((size) => {
    document.documentElement.style.fontSize = `${size}px`
  }, rootFont)
  // Keyboard activation: at some sizes the hero button never holds still
  // long enough for a pointer click, which is a page matter, not the dialog.
  await page.getByTestId("series-page-download-button").focus()
  await page.keyboard.press("Enter")
  const modal = page.getByTestId("watch-collection-download-modal")
  await expect(modal.getByTestId("language-combobox-trigger")).toBeVisible()
  // The quality tiers arrive with the collection options from Admin.
  await expect(
    modal.getByTestId("watch-collection-download-quality"),
  ).toBeEnabled({ timeout: 15_000 })
  return modal
}

for (const viewport of viewports) {
  for (const rootFont of rootFonts) {
    test(`collection fields show the selected values at ${viewport.width}x${viewport.height}, ${rootFont}px root text`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      const modal = await openCollectionDownload(page, rootFont)
      const trigger = modal.getByTestId("language-combobox-trigger")
      const quality = modal.getByTestId("watch-collection-download-quality")

      for (const language of languages) {
        // A real pointer click on the option: Playwright scrolls it into view
        // and fails if another element receives the click.
        await trigger.click()
        const popover = page.getByTestId("language-combobox-popover")
        await popover.getByTestId("language-combobox-search").fill(language)
        await popover.getByRole("option", { name: language }).first().click()
        await expect(popover).toBeHidden()
        await expect(trigger).toContainText(language)

        const texts = [
          ...(await trigger.locator(".truncate").all()),
          quality.locator("span").first(),
        ]
        for (const text of texts) {
          const geometry = await measureText(text)
          expect(geometry, `${language}: ${geometry.text}`).toMatchObject({
            ellipsis: false,
            clippedInk: 0,
          })
          // Below sm the dialog is a phone sheet. At 320 px with 200% text a
          // long word can be wider than the whole select, so only the sm
          // layout, where the fields sit beside the fixed close, must keep
          // every word whole.
          if (viewport.width >= 640) {
            expect(
              geometry.brokenWords,
              `${language}: ${geometry.text}`,
            ).toEqual([])
          }
        }
      }

      // The fields stay inside the dialog and the page does not scroll
      // sideways.
      const modalBox = await modal.boundingBox()
      for (const field of [trigger, quality]) {
        const box = await field.boundingBox()
        expect(box!.x).toBeGreaterThanOrEqual(modalBox!.x - 1)
        expect(box!.x + box!.width).toBeLessThanOrEqual(
          modalBox!.x + modalBox!.width + 1,
        )
      }
      const sideways = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      )
      expect(sideways).toBe(0)

      // The quality list opens below its trigger and does not flip, so put
      // the trigger near the top first, as a user scrolls to it. A trigger
      // that is even a fraction of a pixel out of view makes Playwright
      // scroll it back to the middle. The last option is chosen with the
      // keyboard, which works at any height; the first option takes a real
      // pointer click.
      const openQuality = async () => {
        await quality.evaluate((element) => {
          element.scrollIntoView({ block: "start" })
          const viewport = element.closest('[data-slot="dialog-viewport"]')
          if (viewport) viewport.scrollTop -= 8
        })
        await quality.click()
      }
      const list = page.getByTestId("watch-collection-download-quality-list")
      const options = list.getByRole("option")
      await openQuality()
      const lastLabel = (await options.last().textContent())?.trim() ?? ""
      await page.keyboard.press("End")
      await page.keyboard.press("Enter")
      await expect(list).toBeHidden()
      await expect(quality).toHaveText(lastLabel)
      await openQuality()
      const firstLabel = (await options.first().textContent())?.trim() ?? ""
      await options.first().click()
      await expect(list).toBeHidden()
      await expect(quality).toHaveText(firstLabel)
    })
  }
}
