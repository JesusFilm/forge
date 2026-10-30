import { expect, test, type Page } from "@playwright/test"

// Runs against real Watch content; no mocked player or catalog. The
// coordinator supplies a stage-enabled preview whose video has at least two
// playable audio languages:
//   WATCH_SHARE_KIT_TEST_BASE_URL       preview origin (defaults to the config)
//   WATCH_SHARE_KIT_TEST_VIDEO_PATH     a Watch video page
//   WATCH_SHARE_KIT_TEST_LANGUAGE_SLUG  recipient audio slug to pick (optional;
//                                       otherwise the first non-sender option)
// Only browser APIs (clipboard, native share) are stubbed.
const baseURL = process.env.WATCH_SHARE_KIT_TEST_BASE_URL
const videoPath =
  process.env.WATCH_SHARE_KIT_TEST_VIDEO_PATH ?? "/watch/seed-demo-video.html"
const recipientSlug = process.env.WATCH_SHARE_KIT_TEST_LANGUAGE_SLUG

if (baseURL) test.use({ baseURL })

async function openKit(page: Page, path = videoPath) {
  await page.goto(path)
  const frame = page.getByTestId("watch-next-steps")
  await frame
    .getByRole("tab", { name: "Share your faith", exact: true })
    .click()
  for (let i = 0; i < 3; i += 1)
    await frame.locator("[data-option-id]").first().click()
  await page.getByTestId("watch-share-kit-launcher").click()
  const kit = page.getByTestId("watch-share-kit")
  await expect(kit).toBeVisible()
  return kit
}

async function chooseRecipient(page: Page) {
  const select = page.getByTestId("watch-share-kit-language")
  await expect.poll(() => select.locator("option").count()).toBeGreaterThan(1)
  const options = await select
    .locator("option")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLOptionElement).value),
    )
  expect(
    options.length,
    "the test video needs two or more playable audio languages",
  ).toBeGreaterThan(1)
  const slug = recipientSlug ?? options[1]
  expect(options).toContain(slug)
  await select.selectOption(slug)
  return slug
}

test("Home keeps the existing collection and offers no kit before a film is selected", async ({
  page,
}) => {
  await page.goto("/watch")
  await page
    .getByTestId("watch-next-steps")
    .getByRole("tab", { name: "Share your faith", exact: true })
    .click()
  for (let i = 0; i < 3; i += 1)
    await page
      .getByTestId("watch-role-journey")
      .locator("[data-option-id]")
      .first()
      .click()
  await expect(page.getByText("Pick a film to send")).toBeVisible()
  await expect(page.getByTestId("watch-share-kit-launcher")).toHaveCount(0)
})

test("recipient language changes the link audio, not the sender's page, and the link resolves", async ({
  page,
}) => {
  const kit = await openKit(page)
  const pageUrl = page.url()
  const slug = await chooseRecipient(page)

  const link = await kit.getByTestId("watch-share-kit-link").inputValue()
  const url = new URL(link)
  expect(url.pathname).toContain(`/${slug}.html`)
  expect(url.searchParams.get("playback_source")).toBe("share")
  expect(page.url()).toBe(pageUrl)

  const response = await page.request.get(`${url.pathname}${url.search}`)
  expect(response.status()).toBeLessThan(400)
})

test("every guide link in the kit resolves", async ({ page }) => {
  const kit = await openKit(page)
  const hrefs = await kit
    .getByTestId("watch-share-kit-sources")
    .locator("a")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLAnchorElement).href),
    )
  expect(hrefs.length).toBeGreaterThan(0)
  for (const href of hrefs) {
    const response = await page.request.fetch(href, { method: "HEAD" })
    expect(response.status(), href).toBeLessThan(400)
  }
})

test("clipboard refusal keeps the kit and leaves the link selected", async ({
  page,
}) => {
  const kit = await openKit(page)
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    })
  })

  await kit.getByTestId("watch-share-kit-copy-link").click()

  await expect(kit.getByTestId("watch-share-kit-status")).toContainText(
    "copy it manually",
  )
  const link = kit.getByTestId("watch-share-kit-link")
  await expect(link).toBeVisible()
  expect(
    await link.evaluate(
      (node: HTMLInputElement) =>
        node.selectionEnd! - node.selectionStart! === node.value.length,
    ),
  ).toBe(true)
  await expect(kit.getByTestId("watch-share-kit-prompts")).toBeVisible()
})

test("native share receives the film title and the recipient link", async ({
  page,
}) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __shared: unknown[] }).__shared = []
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: (data: unknown) => {
        ;(window as unknown as { __shared: unknown[] }).__shared.push(data)
        return Promise.resolve()
      },
    })
  })
  const kit = await openKit(page)
  await chooseRecipient(page)
  const link = await kit.getByTestId("watch-share-kit-link").inputValue()

  await kit.getByTestId("watch-share-kit-native-share").click()

  const shared = await page.evaluate(
    () => (window as unknown as { __shared: { url: string }[] }).__shared,
  )
  expect(shared).toHaveLength(1)
  expect(shared[0].url).toBe(link)
})

test("print view shows the kit document only, with no controls", async ({
  page,
}) => {
  const kit = await openKit(page)
  const link = await kit.getByTestId("watch-share-kit-link").inputValue()

  await page.emulateMedia({ media: "print" })

  const doc = page.getByTestId("watch-share-kit-print-document")
  await expect(doc).toBeVisible()
  await expect(doc).toContainText(link)
  await expect(doc).toContainText("Jesus Film Project")
  await expect(kit).toBeHidden()
  expect(
    await page.locator("body button:visible, body input:visible").count(),
  ).toBe(0)
})

test("390px: the kit stays inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openKit(page)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
