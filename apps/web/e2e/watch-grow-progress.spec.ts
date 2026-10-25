import { expect, test, type BrowserContext, type Page } from "@playwright/test"

// Beginning With Jesus progress (feat-731 U10) against a real Watch page where
// the stage shell mounts WatchGrow for the Grow audience.
//
// Anonymous cases need only the page. Signed-in cases use a normal hosted
// credential/PKCE flow with an isolated local identity supplied in memory by
// the coordinator. Never log or retain test credentials, cookies or tokens.
const growPath = process.env.WATCH_GROW_TEST_PATH ?? "/watch?as=grow"
const testEmail = process.env.WATCH_GROW_TEST_EMAIL
const testPassword = process.env.WATCH_GROW_TEST_PASSWORD
const PROGRESS_PATH = "/watch/api/learning-progress"

test.use({ trace: "off", video: "off", screenshot: "off" })

async function openGrow(page: Page, path = growPath) {
  await page.goto(path)
  const grow = page.getByTestId("watch-grow")
  if (!(await grow.isVisible().catch(() => false))) {
    // Ordinary entry is questionnaire-first; the shell owns that flow.
    await page
      .getByRole("tab", { name: /grow/i })
      .first()
      .click()
      .catch(() => {})
  }
  if (!(await grow.isVisible().catch(() => false))) {
    for (let i = 0; i < 3; i += 1)
      await page
        .getByTestId("watch-role-journey")
        .locator("[data-option-id]")
        .first()
        .click()
  }
  await expect(grow).toBeVisible()
  return grow
}

async function openCourse(page: Page) {
  await page.getByRole("button", { name: "Open the nine lessons" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Choose a lesson")).toBeVisible()
  return dialog
}

/** Records learning-progress mutations without reading any credential. */
function watchMutations(page: Page) {
  const bodies: string[] = []
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === PROGRESS_PATH &&
      request.method() !== "GET"
    ) {
      bodies.push(request.postData() ?? "")
    }
  })
  return bodies
}

async function signIn(
  context: BrowserContext,
  page: Page,
  baseURL: string,
  returnPath: string,
) {
  expect(["localhost", "127.0.0.1"]).toContain(new URL(baseURL).hostname)
  const login = new URL("/watch/api/auth/login", baseURL)
  login.searchParams.set("returnTo", returnPath)
  await page.goto(login.href)
  await page.waitForURL((url) => url.pathname === "/login")
  await page.waitForLoadState("networkidle")
  await page.locator("#email").fill(testEmail!)
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await page.locator("#password").fill(testPassword!)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(
    (url) =>
      url.origin === new URL(baseURL).origin &&
      !url.pathname.includes("/api/auth/"),
  )
  const session = await context.request.get(
    `${baseURL}/watch/api/auth/session?callbackURL=${encodeURIComponent(returnPath)}`,
  )
  expect((await session.json()).authenticated).toBe(true)
}

test.describe("Grow lesson story and progress", () => {
  test("anonymous: all 26 cards by keyboard, no completion or network write, drafts shared", async ({
    page,
  }) => {
    const mutations = watchMutations(page)
    const storyChunks: string[] = []
    page.on("request", (request) => {
      if (/WatchGrowStory/.test(request.url())) storyChunks.push(request.url())
    })
    await openGrow(page)
    const opener = page.getByRole("button", { name: "Open the nine lessons" })
    await opener.evaluate((element) =>
      element.scrollIntoView({ block: "center" }),
    )
    await opener.evaluate((element) => {
      element.addEventListener(
        "pointerdown",
        () => {
          element.setAttribute("data-test-open-scroll", String(window.scrollY))
        },
        { once: true },
      )
    })
    const dialog = await openCourse(page)
    const scrollBefore = Number(
      await page
        .locator("[data-test-open-scroll]")
        .getAttribute("data-test-open-scroll"),
    )
    await expect(dialog.getByTestId("watch-grow-progress")).toHaveAttribute(
      "data-progress-state",
      "anonymous",
    )
    await dialog.getByRole("button", { name: "Read as story" }).click()
    const story = dialog.getByTestId("watch-grow-story")
    await expect(story).toHaveAttribute("data-card-id", "cover")
    await expect(story).toContainText("Start here if")

    for (let index = 1; index < 26; index++) {
      await page.keyboard.press("ArrowRight")
      await expect(story).toHaveAttribute("data-card-index", String(index))
      if (index === 1) {
        // Typing must not move the story.
        const draft = story.locator("textarea")
        await draft.fill("private-reflection-e2e")
        await draft.press("ArrowRight")
        await expect(story).toHaveAttribute("data-card-index", "1")
        await story.getByRole("heading").first().focus()
      }
    }
    await expect(story).toHaveAttribute("data-card-id", "end")
    await expect(story).toContainText("Lesson not marked complete.")

    await story.getByRole("button", { name: "Back to lesson sheet" }).click()
    await expect(
      dialog.getByRole("button", { name: "Read as story" }),
    ).toBeFocused()
    await expect(
      dialog.locator('[data-step-id="back-how"] textarea'),
    ).toHaveValue("private-reflection-e2e")
    expect(mutations).toEqual([])

    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "Open the nine lessons" }),
    ).toBeFocused()
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBe(scrollBefore)
  })

  test("390px: story stays inside the viewport and usable with reduced motion", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    })
    const page = await context.newPage()
    await openGrow(page)
    const dialog = await openCourse(page)
    await dialog.getByRole("button", { name: "Read as story" }).click()
    const story = dialog.getByTestId("watch-grow-story")
    await story.getByRole("button", { name: "Next" }).click()
    await expect(story).toHaveAttribute("data-card-id", "back-how")
    const box = await story.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await context.close()
  })

  test("anonymous save intent goes to the real hosted sign-in; cancelling returns to the same unsaved card", async ({
    page,
    baseURL,
  }) => {
    await openGrow(page)
    const dialog = await openCourse(page)
    await dialog.getByRole("button", { name: "Read as story" }).click()
    const story = dialog.getByTestId("watch-grow-story")
    await story.getByRole("button", { name: "Next" }).click()
    await story.locator("textarea").fill("never-in-url-e2e")
    await dialog
      .getByRole("button", { name: "Save progress to an account" })
      .click()
    const href = await dialog
      .getByTestId("watch-grow-sign-in")
      .getAttribute("href")
    const login = new URL(href!)
    expect(login.pathname).toBe("/watch/api/auth/login")
    const returnTo = login.searchParams.get("returnTo")!
    expect(returnTo).toContain("growLesson=lesson-1")
    expect(returnTo).toContain("growCard=back-how")
    expect(href).not.toContain("never-in-url-e2e")

    // Enter the real hosted flow, then deliver an OAuth denial to the actual
    // callback. Its existing failure path consumes the handshake and returns
    // to the stored lesson/card; no signed-in session is invented.
    await dialog.getByTestId("watch-grow-sign-in").click()
    await page.waitForURL((url) => url.pathname === "/login")
    const denied = new URL(
      "/watch/api/auth/callback?error=access_denied",
      baseURL,
    )
    await page.goto(denied.href)
    const back = page.getByRole("dialog")
    await expect(back.getByTestId("watch-grow-story")).toHaveAttribute(
      "data-card-id",
      "back-how",
    )
    await expect(back).toContainText(
      "Sign-in did not finish. Nothing was saved",
    )
    await expect(back.getByTestId("watch-grow-progress")).toHaveAttribute(
      "data-progress-state",
      "anonymous",
    )
    expect(new URL(page.url()).searchParams.has("growLesson")).toBe(false)
    await back
      .getByTestId("watch-grow-story")
      .getByRole("button", { name: "Next" })
      .click()
    await expect(back.getByTestId("watch-grow-story")).toHaveAttribute(
      "data-card-id",
      "back-carrying",
    )
  })

  test("signed in: return restores the card unsaved, explicit save persists, a second device resumes, reflections never sent", async ({
    browser,
    baseURL,
  }) => {
    test.skip(
      !testEmail || !testPassword,
      "needs an isolated local hosted-Auth credential identity",
    )
    const first = await browser.newContext()
    const page = await first.newPage()
    const mutations = watchMutations(page)
    const returnPath = `${growPath}${growPath.includes("?") ? "&" : "?"}growLesson=lesson-1&growCard=up-question-1`
    await signIn(first, page, baseURL!, returnPath)

    const dialog = page.getByRole("dialog")
    const story = dialog.getByTestId("watch-grow-story")
    await expect(story).toHaveAttribute("data-card-id", "up-question-1")
    await expect(dialog).toContainText("not saved to your account yet")
    expect(mutations).toEqual([])

    await story.locator("textarea").fill("private-reflection-signed-in")
    await story.getByRole("checkbox").check()
    await expect(dialog).toContainText("Saved to your account.")
    await story.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: /close/i }).first().click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect.poll(() => mutations.length).toBeGreaterThanOrEqual(2)
    for (const body of mutations) {
      expect(body).not.toContain("private-reflection-signed-in")
      expect(Object.keys(JSON.parse(body)).sort()).toEqual(
        [
          "completed",
          "completedMovementIds",
          "completedStepIds",
          "contentVersion",
          "courseId",
          "expectedRevision",
          "lessonId",
          "resumeCardId",
        ].sort(),
      )
    }

    // Reload: progress is the account's, not the tab's.
    await page.reload()
    await openGrow(page)
    const reloaded = await openCourse(page)
    await expect(reloaded).toContainText("Saved to your account.")
    await expect(
      reloaded.locator('[data-step-id="up-question-1"] input[type="checkbox"]'),
    ).toBeChecked()
    await expect(
      reloaded.locator('[data-step-id="up-question-1"] textarea'),
    ).toHaveValue("")

    // A second browser signed in to the same account resumes the position.
    const second = await browser.newContext()
    const other = await second.newPage()
    await signIn(second, other, baseURL!, growPath)
    await openGrow(other)
    const otherDialog = await openCourse(other)
    await expect(otherDialog).toContainText("Saved to your account.")
    await otherDialog.getByRole("button", { name: "Read as story" }).click()
    await expect(otherDialog.getByTestId("watch-grow-story")).toHaveAttribute(
      "data-card-id",
      "up-question-2",
    )
    await second.close()
    await first.close()
  })
})
