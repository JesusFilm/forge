import { expect, test } from "./watch-audience-test"

const film = process.env.WATCH_AUDIENCE_TEST_FILM_SLUG ?? "jesus-feature-film"

for (const language of ["english", "arabic-modern-standard"]) {
  test.describe(`role menu on ${language} film`, () => {
    test.use({ viewport: { width: 1780, height: 900 }, hasTouch: true })

    test.beforeEach(async ({ page }) => {
      await page.goto(`/watch/${film}.html/${language}.html`)
      await expect(page.locator("html")).toHaveAttribute(
        "lang",
        language === "english" ? "en" : "ar",
      )
    })

    test("owns its English fallback language and fully manages keyboard focus", async ({
      page,
    }) => {
      const chip = page.getByTestId("watch-role-chip")
      const trigger = chip.getByRole("button", { name: /^Who is this for\?/ })
      const menu = chip.getByRole("menu", { name: /^Who is this for\?/ })
      const roles = menu.getByRole("menuitemradio")
      const shortcut = menu.getByRole("menuitem", { exact: true })
      await expect(chip).toHaveAttribute("lang", "en")
      await expect(chip).toHaveAttribute("dir", "ltr")
      await expect(trigger).toHaveAttribute("aria-haspopup", "menu")
      await expect(trigger).toHaveAccessibleName(
        "Who is this for? I’m exploring",
      )
      await expect(trigger).toHaveAttribute("aria-expanded", "false")
      await trigger.focus()
      await page.keyboard.press("ArrowDown")
      await expect(roles).toHaveCount(4)
      await expect(roles.first()).toBeFocused()
      await expect(trigger).toHaveAttribute(
        "aria-controls",
        (await menu.getAttribute("id")) as string,
      )
      await expect(menu).toHaveAttribute(
        "aria-labelledby",
        (await trigger.getAttribute("id")) as string,
      )
      // Fixture publication resolves to English even on Arabic audio/document.
      // Preserve the exact authored role strings and their own boundaries.
      await expect(roles).toHaveText([
        "I’m exploringExplore faith · new here",
        "I follow JesusGrow in faith · following Jesus",
        "I share my faithShare your faith · with people you know",
        "I’m a ministry partnerPartner with us · churches & ministries",
      ])
      for (const item of [...(await roles.all()), shortcut]) {
        await expect(item).toHaveAttribute("lang", "en")
        await expect(item).toHaveAttribute("dir", "ltr")
        await expect(item).toHaveCSS("direction", "ltr")
        await expect(item).toHaveAttribute("tabindex", "-1")
      }
      await expect(roles.first()).toHaveAttribute("aria-checked", "true")
      await page.keyboard.press("ArrowUp")
      await expect(shortcut).toBeFocused()
      await page.keyboard.press("Home")
      await expect(roles.first()).toBeFocused()
      await page.keyboard.press("ArrowDown")
      await expect(roles.nth(1)).toBeFocused()
      await page.keyboard.press("End")
      await expect(shortcut).toBeFocused()
      await page.keyboard.press("ArrowDown")
      await expect(roles.first()).toBeFocused()
      await page.keyboard.press("Escape")
      await expect(menu).toHaveCount(0)
      await expect(trigger).toBeFocused()

      await page.keyboard.press("ArrowUp")
      await expect(shortcut).toBeFocused()
      await page.keyboard.press("Home")
      await page.keyboard.press("ArrowDown")
      await page.keyboard.press("Enter")
      await expect(menu).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await expect(chip).toHaveAttribute("data-role", "grow")
      await expect(page.getByTestId("watch-next-steps")).toHaveAttribute(
        "data-role",
        "grow",
      )
      await page.keyboard.press("Enter")
      await expect(roles.first()).toBeFocused()
      await expect(roles.nth(1)).toHaveAttribute("aria-checked", "true")
      await page.keyboard.press("ArrowDown")
      await page.keyboard.press("ArrowDown")
      await page.keyboard.press("Space")
      await expect(menu).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await expect(chip).toHaveAttribute("data-role", "share")

      // Learn the real page's adjacent tab stops with the menu closed, then
      // require native Tab/Shift+Tab to reach those same elements from a menu.
      await page.keyboard.press("Tab")
      const after = await page.evaluateHandle(() => document.activeElement)
      await trigger.focus()
      await page.keyboard.press("Shift+Tab")
      const before = await page.evaluateHandle(() => document.activeElement)
      for (const [key, target] of [
        ["Tab", after],
        ["Shift+Tab", before],
      ] as const) {
        await trigger.focus()
        await page.keyboard.press("Space")
        await expect(roles.first()).toBeFocused()
        await page.keyboard.press("End")
        await page.keyboard.press(key)
        await expect(menu).toHaveCount(0)
        expect(
          await target.evaluate((node) => node === document.activeElement),
        ).toBe(true)
      }
      await after.dispose()
      await before.dispose()
    })

    test("supports touch/click selection and outside dismissal without stealing focus", async ({
      page,
    }) => {
      const chip = page.getByTestId("watch-role-chip")
      const trigger = chip.getByRole("button", { name: /^Who is this for\?/ })
      const menu = chip.getByRole("menu")
      const roles = menu.getByRole("menuitemradio")
      await trigger.tap()
      await expect(roles.first()).toBeFocused()
      await roles.nth(2).tap()
      await expect(menu).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await expect(chip).toHaveAttribute("data-role", "share")
      await trigger.click()
      await expect(roles.nth(2)).toHaveAttribute("aria-checked", "true")
      await trigger.click()
      await expect(menu).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await trigger.click()
      const outside = page.getByTestId("floating-header-language-videos-link")
      await outside.focus()
      await expect(menu).toHaveCount(0)
      await expect(outside).toBeFocused()
      await trigger.tap()
      await page.locator("main").tap({ position: { x: 10, y: 200 } })
      await expect(menu).toHaveCount(0)
      await expect(trigger).not.toBeFocused()
    })

    test("keeps an accessible selected name when the visible chip yields to the compact header", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 844 })
      const chip = page.getByTestId("watch-role-chip")
      const trigger = chip.getByRole("button", {
        name: "Who is this for? I’m exploring",
        exact: true,
      })
      await expect(trigger).toBeVisible()
      await expect(trigger.locator("span[lang]")).not.toBeVisible()
      await trigger.focus()
      await page.keyboard.press("Enter")
      await expect(chip.getByRole("menuitemradio").first()).toBeFocused()
      await expect(chip.getByRole("menu")).toHaveAccessibleName(
        "Who is this for?",
      )
      await expect(chip.getByRole("menuitemradio").first()).toHaveAttribute(
        "aria-checked",
        "true",
      )
      await page.keyboard.press("Escape")
      await expect(trigger).toBeFocused()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBe(0)
    })
  })
}
