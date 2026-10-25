import { expect, test } from "@playwright/test"

const fixturePath = "/watch/demo-search/language-inventory-fixture"

test("keeps a long inventory navigable while filtering content-visibility rows", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as unknown as {
      __inventoryVisibilityStates: WeakMap<Element, boolean>
    }
    state.__inventoryVisibilityStates = new WeakMap()
    document.addEventListener(
      "contentvisibilityautostatechange",
      (event) => {
        const target = event.target
        if (
          target instanceof HTMLElement &&
          target.hasAttribute("data-inv-item")
        ) {
          state.__inventoryVisibilityStates.set(
            target,
            (event as Event & { skipped: boolean }).skipped,
          )
        }
      },
      true,
    )
  })
  await page.goto(fixturePath)

  const lastCompactRow = page.locator("[data-inv-item]").nth(139)
  await expect(lastCompactRow).toHaveCSS("content-visibility", "auto")
  await expect(lastCompactRow).toHaveCSS("contain-intrinsic-size", /auto 56px/)
  await expect
    .poll(() =>
      lastCompactRow.evaluate((element) => {
        const state = window as unknown as {
          __inventoryVisibilityStates: WeakMap<Element, boolean>
        }
        return state.__inventoryVisibilityStates.get(element)
      }),
    )
    .toBe(true)

  await page.evaluate(() => {
    window.location.hash = "subtitles-only"
  })
  await expect(page).toHaveURL(/#subtitles-only$/)

  const subtitleSection = page.getByTestId("language-inventory-subtitle-only")
  const subtitleTarget = page.getByRole("link", {
    name: "Below-fold subtitle target",
  })
  await expect
    .poll(() =>
      subtitleSection.evaluate((element) => {
        const { bottom, top } = element.getBoundingClientRect()
        return top >= 0 && top < window.innerHeight && bottom > 0
      }),
    )
    .toBe(true)
  await expect(subtitleTarget).toBeVisible()

  await page.getByTestId("language-inventory-filters-toggle").click()
  await page.getByTestId("language-inventory-filter-type-episode").click()
  await expect(subtitleSection).toBeHidden()
  await expect(subtitleTarget).toBeHidden()

  await page.getByTestId("language-inventory-filters-clear").click()
  await expect(subtitleSection).toBeVisible()
  await expect(subtitleTarget).toBeVisible()

  await page.getByTestId("language-inventory-filter-type-shortFilm").click()
  await expect(subtitleSection).toBeVisible()
  await expect(subtitleTarget).toBeVisible()
  await expect(
    page.getByTestId("language-inventory-audio-collections"),
  ).toBeHidden()
})
