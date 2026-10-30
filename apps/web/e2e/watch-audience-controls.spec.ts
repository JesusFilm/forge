import type { Locator } from "@playwright/test"
import { expect, test } from "./watch-audience-test"

test.use({ hasTouch: true })

const film = process.env.WATCH_AUDIENCE_TEST_FILM_SLUG ?? "jesus-feature-film"

async function visibleFocus(control: Locator, name: string) {
  await expect(control).toBeFocused()
  await expect(control).toHaveCSS("outline-style", "solid")
  await expect(control).toHaveCSS("outline-width", "2px")
  await expect(control).not.toHaveCSS("outline-color", "rgba(0, 0, 0, 0)")
  await control.scrollIntoViewIfNeeded()
  await test.info().attach(name, {
    body: await control.page().screenshot({
      path: test.info().outputPath(name.replace(/\W/g, "-") + ".png"),
    }),
    contentType: "image/png",
  })
}

for (const width of [390, 1280]) {
  for (const language of ["english", "arabic-modern-standard"]) {
    test.describe(`audience controls ${language} at ${width}`, () => {
      test.use({ viewport: { width, height: 900 }, hasTouch: true })
      test("native course radios select with arrows, have one Tab stop and visible focus", async ({
        page,
      }) => {
        const writes: string[] = []
        page.on("request", (request) => {
          if (
            request.method() !== "GET" &&
            /learning-progress/.test(request.url())
          )
            writes.push(request.url())
        })
        await page.goto(
          `/watch/${film}.html/${language}.html?as=grow&grow=full`,
        )
        const group = page.getByRole("radiogroup", {
          name: "How you are using the guide",
        })
        const radios = group.getByRole("radio")
        await expect(radios).toHaveCount(3)
        await expect(radios.nth(0)).toHaveAccessibleName("On my own")
        await expect(radios.nth(1)).toHaveAccessibleName("In a group")
        await expect(radios.nth(2)).toHaveAccessibleName("Leading a group")
        await radios.first().focus()
        for (const [key, index] of [
          ["ArrowRight", 1],
          ["ArrowDown", 2],
          ["ArrowRight", 0],
          ["ArrowLeft", 2],
          ["ArrowUp", 1],
        ] as const) {
          await page.keyboard.press(key)
          await expect(radios.nth(index)).toBeFocused()
          await expect(radios.nth(index)).toBeChecked()
          await expect(group.locator("input:checked")).toHaveCount(1)
        }
        await expect(group).toHaveAttribute("lang", "en")
        await expect(group).toHaveCSS("direction", "ltr")
        const label = radios.nth(1).locator("..")
        await expect(label).toHaveCSS("outline-style", "solid")
        await expect(label).toHaveCSS("outline-width", "2px")
        await expect(label).toHaveCSS("outline-color", "rgb(255, 255, 255)")
        await label.scrollIntoViewIfNeeded()
        await test.info().attach("visible course focus", {
          body: await label.page().screenshot({
            path: test.info().outputPath("course-visible-focus.png"),
          }),
          contentType: "image/png",
        })
        await page.keyboard.press("Tab")
        await expect(radios.nth(1)).not.toBeFocused()
        expect(
          await group.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        ).toBe(false)
        await page.keyboard.press("Shift+Tab")
        await expect(radios.nth(1)).toBeFocused()
        await page.keyboard.press("Shift+Tab")
        expect(
          await group.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        ).toBe(false)
        await page.keyboard.press("Tab")
        await expect(radios.nth(1)).toBeFocused()
        await radios.first().focus()
        await page.keyboard.press("Space")
        await expect(radios.first()).toBeChecked()
        await radios.nth(2).locator("..").tap()
        await expect(radios.nth(2)).toBeChecked()
        await radios.first().locator("..").click()
        await expect(radios.first()).toBeChecked()
        const bounds = await group.boundingBox()
        expect(bounds!.width).toBeLessThanOrEqual(width)
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        ).toBe(0)
        expect(writes).toEqual([])
      })

      test("Finder duration radios retain native keyboard and visible focus inside the English portal", async ({
        page,
      }) => {
        await page.goto(`/watch/${film}.html/${language}.html?as=grow`)
        const opener = page
          .getByRole("button", { name: "Find films for you", exact: true })
          .first()
        await opener.click()
        const flow = page.getByRole("dialog", { name: "Find films for you" })
        for (const step of ["lanes", "fact", "time"]) {
          await flow.getByRole("button", { name: "Next", exact: true }).click()
          await expect(flow).toHaveAttribute("data-step", step)
        }
        const group = flow.getByRole("radiogroup", { name: "How much time" })
        const radios = group.getByRole("radio")
        await expect(radios).toHaveCount(3)
        await expect(group).toHaveAttribute("lang", "en")
        await expect(group).toHaveCSS("direction", "ltr")
        await radios.nth(1).focus()
        await expect(radios.nth(1)).toBeChecked()
        await page.keyboard.press("ArrowDown")
        await expect(radios.nth(2)).toBeFocused()
        await expect(radios.nth(2)).toBeChecked()
        expect(
          await radios
            .nth(2)
            .locator("..")
            .evaluate((el) => getComputedStyle(el).boxShadow),
        ).toContain("2px")
        await page.keyboard.press("Tab")
        expect(
          await group.evaluate((el) => el.contains(document.activeElement)),
        ).toBe(false)
        await page.keyboard.press("Shift+Tab")
        await expect(radios.nth(2)).toBeFocused()
        await radios.first().locator("..").tap()
        await expect(radios.first()).toBeChecked()
        await page.keyboard.press("Escape")
        await expect(flow).toHaveCount(0)
        await expect(opener).toBeFocused()
      })

      test("Grow and Partner resource tabs support automatic activation and an associated panel", async ({
        page,
        context,
        baseURL,
      }) => {
        const session = process.env.WATCH_PARTNER_TEST_SESSION_COOKIE
        expect(
          session,
          "Requires a session from a genuine hosted Auth round trip",
        ).toBeTruthy()
        await context.addCookies([
          {
            name: "forge_web_session",
            value: session!,
            url: baseURL!,
            httpOnly: true,
            sameSite: "Lax",
          },
        ])
        const response = await context.request.get(
          "/watch/api/auth/session?callbackURL=%2Fwatch",
        )
        expect((await response.json()).authenticated).toBe(true)
        for (const [role, label] of [
          ["grow", "Who the plan is for"],
          ["partner", "Filter resources"],
        ]) {
          await page.goto(
            `/watch/${film}.html/${language}.html?as=${role}${role === "grow" ? "&grow=full" : ""}`,
          )
          const group = page.getByRole("tablist", { name: label })
          const tabs = group.getByRole("tab")
          await expect(tabs.first()).toBeVisible()
          await tabs.first().focus()
          const count = await tabs.count()
          for (const [key, index] of [
            ["ArrowRight", 1],
            ["End", count - 1],
            ["ArrowRight", 0],
            ["ArrowLeft", count - 1],
            ["Home", 0],
          ] as const) {
            await page.keyboard.press(key)
            await expect(tabs.nth(index)).toBeFocused()
            await expect(tabs.nth(index)).toHaveAttribute(
              "aria-selected",
              "true",
            )
            await expect(group.locator('[tabindex="0"]')).toHaveCount(1)
            const panel = page
              .locator('[role="tabpanel"]')
              .filter({ hasNot: page.getByTestId("watch-role-journey") })
            const panelId = await tabs.nth(index).getAttribute("aria-controls")
            await expect(panel).toHaveAttribute("id", panelId!)
            await expect(panel).toHaveAttribute(
              "aria-labelledby",
              (await tabs.nth(index).getAttribute("id"))!,
            )
            await expect(panel.getByRole("link").first()).toBeVisible()
          }
          // Keyboard traversal can leave the row beneath the fixed Watch header.
          // Center the real touch target before changing input modality.
          await tabs
            .nth(1)
            .evaluate((el) => el.scrollIntoView({ block: "center" }))
          await tabs.nth(1).tap()
          await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true")
          await page.keyboard.press("ArrowRight")
          if (role === "grow") {
            await expect(tabs.nth(2)).toBeFocused()
            await expect(tabs.nth(2)).toHaveCSS("outline-style", "solid")
            await expect(tabs.nth(2)).toHaveCSS("outline-width", "3px")
            await expect(tabs.nth(2)).toHaveCSS(
              "outline-color",
              "rgb(37, 99, 235)",
            )
            await expect(tabs.nth(2)).toHaveCSS("outline-offset", "-4px")
          } else {
            expect(
              await tabs
                .nth(2)
                .evaluate((el) => getComputedStyle(el).boxShadow),
            ).toContain("2px")
          }
          const panel = page
            .locator('[role="tabpanel"]')
            .filter({ hasNot: page.getByTestId("watch-role-journey") })
          await page.keyboard.press("Tab")
          await expect(panel).toBeFocused()
          await page.keyboard.press("Shift+Tab")
          await expect(tabs.nth(2)).toBeFocused()
          // These tabs activate automatically on arrow navigation. Reach the
          // next target through that real roving flow, rather than imperatively
          // focusing an unselected, untabbable button outside the user pattern.
          await page.keyboard.press("ArrowLeft")
          await expect(tabs.nth(1)).toBeFocused()
          await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true")
          await page.keyboard.press("Space")
          await expect(tabs.nth(1)).toBeFocused()
          await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true")
          await expect(group.locator('[tabindex="0"]')).toHaveCount(1)
        }
      })
    })
  }
}

// Runs against the real production editor component/CSS mounted in an isolated
// browser fixture, or the authenticated editor URL supplied by a local harness.
test("Admin audience tabs retain authored edits and expose keyboard/focus/panel semantics", async ({
  page,
}) => {
  test.skip(
    !process.env.WATCH_AUDIENCE_EDITOR_TEST_URL,
    "Requires an isolated Admin editor fixture URL",
  )
  await page.goto(process.env.WATCH_AUDIENCE_EDITOR_TEST_URL!)
  const group = page.getByRole("tablist", { name: "Audience roles" })
  const tabs = group.getByRole("tab")
  await expect(tabs).toHaveText(["explore", "grow", "share", "partner"])
  await tabs.first().focus()
  await page.keyboard.press("ArrowRight")
  await expect(tabs.nth(1)).toBeFocused()
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Home")
  const ids = await tabs.evaluateAll((elements) => elements.map((el) => el.id))
  const panels = await tabs.evaluateAll((elements) =>
    elements.map((el) => el.getAttribute("aria-controls")),
  )
  expect(new Set(ids).size).toBe(4)
  expect(new Set(panels).size).toBe(1)
  for (const direction of ["ltr", "rtl"]) {
    await page.locator("html").evaluate((el, dir) => {
      el.setAttribute("dir", dir)
      el.setAttribute("lang", dir === "rtl" ? "ar" : "en")
    }, direction)
    await expect(group).toHaveCSS("direction", "ltr")
    await tabs.first().focus()
    await page.keyboard.press("Home")
    for (const [key, index] of [
      ["ArrowRight", 1],
      ["End", 3],
      ["ArrowRight", 0],
      ["ArrowLeft", 3],
      ["Home", 0],
    ] as const) {
      await page.keyboard.press(key)
      const tab = tabs.nth(index)
      await expect(tab).toHaveAttribute("aria-selected", "true")
      await expect(tab).toHaveAttribute("tabindex", "0")
      await expect(group.locator('[tabindex="0"]')).toHaveCount(1)
      await visibleFocus(tab, `Admin ${direction} ${index}`)
      const panel = page.getByRole("tabpanel", {
        name: (await tab.textContent())!,
      })
      await expect(panel).toHaveAttribute("id", panels[index]!)
      await expect(panel).toHaveAttribute("aria-labelledby", ids[index]!)
      await expect(panel.getByRole("textbox").first()).toBeVisible()
    }
    await tabs.nth(3).focus()
    await page.keyboard.press("Space")
    await expect(tabs.nth(3)).toHaveAttribute("aria-selected", "true")
    await tabs.first().focus()
    await page.keyboard.press("Enter")
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true")
    await page.keyboard.press("Tab")
    await expect(
      page.getByRole("textbox", { name: "explore label", exact: true }),
    ).toBeFocused()
    await page
      .getByRole("textbox", { name: "explore heading", exact: true })
      .fill(`Retained ${direction} draft`)
    await tabs.nth(1).tap()
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true")
    await tabs.first().click()
    await expect(
      page.getByRole("textbox", { name: "explore heading", exact: true }),
    ).toHaveValue(`Retained ${direction} draft`)
    expect(
      await tabs.evaluateAll((elements) => elements.map((el) => el.id)),
    ).toEqual(ids)
    expect(
      await tabs.evaluateAll((elements) =>
        elements.map((el) => el.getAttribute("aria-controls")),
      ),
    ).toEqual(panels)
  }
})
