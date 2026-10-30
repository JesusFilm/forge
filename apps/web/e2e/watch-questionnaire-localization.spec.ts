import type { Locator } from "@playwright/test"
import { WatchAudienceConfigurationSchema } from "@forge/experience-schema"
import { arabicAudienceFixture } from "../src/test/fixtures/watch-audience-arabic"
import { expect, test } from "./watch-audience-test"

const arabic = arabicAudienceFixture()
const film = process.env.WATCH_AUDIENCE_TEST_FILM_SLUG ?? "jesus-feature-film"

async function boundary(node: Locator, lang: string, dir: string) {
  await expect(node).toBeVisible()
  expect(
    await node.evaluate((element) => ({
      lang: element.closest("[lang]")?.getAttribute("lang"),
      dir: element.closest("[dir]")?.getAttribute("dir"),
      computed: getComputedStyle(element).direction,
    })),
  ).toEqual({ lang, dir, computed: dir })
}

// A read-only, schema-valid fully Arabic producer fixture isolates rendering.
// The publication suite independently verifies the real local Admin projection
// and hosted Auth contracts, without this read-fixture adapter.
for (const width of [390, 1280]) {
  for (const surface of ["home", "video"] as const) {
    test.describe(`${surface} authored Arabic metadata at ${width}px`, () => {
      test.use({ viewport: { width, height: 844 }, hasTouch: width === 390 })
      test("English names and native tooltip stay independent of Arabic copy through answer/edit/reset", async ({
        page,
      }, info) => {
        test.skip(
          process.env.WATCH_AUDIENCE_TEST_ARABIC_FIXTURE !== "1",
          "Requires fully Arabic read-only producer fixture",
        )
        const response = await fetch(
          process.env.WATCH_AUDIENCE_ARABIC_GRAPHQL_URL ??
            "http://127.0.0.1:4291/api/graphql",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer pr2783-local-test-consumer",
            },
            body: JSON.stringify({
              query:
                'query { watchSetting(locale: "ar") { watchAudience(locale: "ar") { configJson sourceLocale rejected } } }',
            }),
          },
        )
        expect(response.ok).toBe(true)
        const body = (await response.json()) as {
          errors?: unknown
          data: {
            watchSetting: {
              watchAudience: {
                configJson: string
                sourceLocale: string
                rejected: boolean
              }
            }
          }
        }
        expect(body.errors).toBeUndefined()
        const projection = body.data.watchSetting.watchAudience
        expect(projection.sourceLocale).toBe("ar")
        expect(projection.rejected).toBe(false)
        expect(
          WatchAudienceConfigurationSchema.parse(
            JSON.parse(projection.configJson),
          ),
        ).toEqual(arabic)
        await page.goto(
          surface === "home"
            ? "/watch/arabic-modern-standard.html"
            : `/watch/${film}.html/arabic-modern-standard.html`,
        )
        await expect(page.locator("html")).toHaveAttribute("lang", "ar")
        await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
        const tabs = page.getByRole("tablist", {
          name: "Who is this for",
          exact: true,
        })
        await boundary(tabs, "en", "ltr")
        await boundary(tabs.locator(":scope > [lang]"), "ar", "rtl")
        await expect(tabs.getByRole("tab")).toHaveText(
          arabic.roles.map((role) => role.label),
        )
        for (const tab of await tabs.getByRole("tab").all())
          await boundary(tab, "ar", "rtl")
        const explore = tabs.getByRole("tab", {
          name: arabic.roles[0].label,
          exact: true,
        })
        await explore.focus()
        await page.keyboard.press("ArrowRight")
        await expect(
          tabs.getByRole("tab", { name: arabic.roles[1].label, exact: true }),
        ).toBeFocused()
        await page.keyboard.press("Home")
        await expect(explore).toBeFocused()
        await expect(explore).toHaveAttribute("aria-selected", "true")
        if (surface === "home") {
          await boundary(page.getByTestId("watch-home-role-band"), "en", "ltr")
          await expect(page.getByTestId("watch-role-journey")).toHaveCount(0)
          await page.screenshot({
            path: info.outputPath("arabic-home-tabs.png"),
            fullPage: false,
          })
          return
        }
        const journey = page.getByTestId("watch-role-journey")
        const role = arabic.roles[0]
        const question = (index: number) =>
          journey.getByRole("heading", {
            name: role.questions[index].prompt,
            exact: true,
          })
        const choose = async (index: number) => {
          const option = journey.getByRole("button", {
            name: `${role.questions[index].options[0].label} ${role.questions[index].options[0].hint}`,
            exact: true,
          })
          await boundary(option, "ar", "rtl")
          await option.evaluate((element) =>
            element.scrollIntoView({ block: "center" }),
          )
          await option.focus()
          await page.keyboard.press("Enter")
        }
        await boundary(question(0), "ar", "rtl")
        await boundary(
          journey.getByText("Question 1 of 3", { exact: true }),
          "en",
          "ltr",
        )
        await choose(0)
        await expect(question(1)).toBeFocused()
        const trail = journey.getByRole("list", {
          name: "Your answers",
          exact: true,
        })
        await boundary(trail, "en", "ltr")
        const edit = trail.getByRole("button", {
          name: role.questions[0].options[0].label,
          exact: true,
        })
        await boundary(edit, "en", "ltr")
        await expect(edit).toHaveAttribute("title", "Change this answer")
        await expect(edit).toHaveAccessibleDescription("Change this answer")
        await boundary(
          edit.getByText(role.questions[0].options[0].label, { exact: true }),
          "ar",
          "rtl",
        )
        await edit.hover()
        await edit.focus()
        await page.keyboard.press("Shift+Tab")
        await page.keyboard.press("Tab")
        await expect(edit).toBeFocused()
        expect(
          await edit.evaluate((node) => node.matches(":focus-visible")),
        ).toBe(true)
        await page.screenshot({
          path: info.outputPath("arabic-edit-tooltip-focus.png"),
          fullPage: false,
        })
        await page.keyboard.press("Enter")
        await expect(trail).toHaveCount(0)
        await expect(question(0)).toBeFocused()
        for (let index = 0; index < 3; index++) await choose(index)
        await expect(
          journey.getByRole("heading", { name: role.finish, exact: true }),
        ).toBeFocused()
        await boundary(
          journey.getByText("Your next step", { exact: true }),
          "en",
          "ltr",
        )
        await boundary(
          journey.getByText(role.actions[0].title, { exact: true }).first(),
          "ar",
          "rtl",
        )
        await expect(trail.getByRole("button")).toHaveCount(3)
        const reset = journey.getByRole("button", {
          name: "Start over",
          exact: true,
        })
        await boundary(reset, "en", "ltr")
        if (width === 390) await reset.tap()
        else {
          await reset.focus()
          await page.keyboard.press("Enter")
        }
        await expect(trail).toHaveCount(0)
        await expect(question(0)).toBeFocused()
        await boundary(question(0), "ar", "rtl")
        await boundary(
          journey.getByText(role.lead, { exact: true }),
          "ar",
          "rtl",
        )
      })
    })
  }
}
