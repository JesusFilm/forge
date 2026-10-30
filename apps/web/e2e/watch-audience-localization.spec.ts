import type { Locator, Page } from "@playwright/test"
import { expect, test } from "./watch-audience-test"

const film = process.env.WATCH_AUDIENCE_TEST_FILM_SLUG ?? "jesus-feature-film"
const video = (language: string, full = false) =>
  `/watch/${film}.html/${language}.html?as=grow${full ? "&grow=full" : ""}`

async function languageBoundary(node: Locator, lang: string, dir: string) {
  await expect(node).toHaveAttribute("lang", lang)
  await expect(node).toHaveAttribute("dir", dir)
  if (dir !== "auto") await expect(node).toHaveCSS("direction", dir)
}

async function trapFocus(page: Page, dialog: Locator) {
  const controls = dialog.locator(
    'a[href]:visible, button:not([disabled]):visible, input:not([disabled]):visible, textarea:not([disabled]):visible, [tabindex="0"]:visible',
  )
  const first = controls.first()
  const last = controls.last()
  await first.focus()
  await page.keyboard.press("Shift+Tab")
  await expect(last).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(first).toBeFocused()
}

for (const width of [1280, 390]) {
  test.describe(`audience content languages at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: width < 768 })

    test("local media retains decoded playback with external telemetry blocked", async ({
      page,
    }) => {
      test.skip(
        !process.env.WATCH_AUDIENCE_TEST_MEDIA_DIR,
        "Requires deterministic local HLS/poster fixtures",
      )
      await page.goto(video("english"))
      await page.getByRole("button", { name: "Watch now", exact: true }).click()
      const media = page.locator('[data-testid="hero-player-wrapper"] video')
      await expect
        .poll(() =>
          media.evaluate((node: HTMLVideoElement) => ({
            ready: node.readyState >= 2,
            error: node.error?.code ?? null,
          })),
        )
        .toEqual({ ready: true, error: null })
      await expect
        .poll(() =>
          media.evaluate((node: HTMLVideoElement) => node.currentTime),
        )
        .toBeGreaterThan(0)
    })

    for (const [language, seriesTitle, nextTitle, direction, currentTitle] of [
      [
        "arabic-modern-standard",
        "مسيرة المسيح",
        "بداية الخدمة",
        "rtl",
        "البدء",
      ],
      [
        "english",
        "The Life of Jesus",
        "Ministry begins",
        "ltr",
        "The beginning",
      ],
      // A real Urdu dub with English-only title fallback. Title DTOs lack
      // source-locale metadata, so neither title may inherit the Urdu document.
      ["urdu", "The Life of Jesus", "Ministry begins", "ltr", "The beginning"],
    ]) {
      test(`${language} continuation and Share titles isolate content from English labels`, async ({
        page,
      }) => {
        const series =
          process.env.WATCH_AUDIENCE_TEST_SERIES_SLUG ?? "r4-title-series"
        const path = `/watch/${series}.html/r4-title-first/${language}.html`
        await page.goto(`${path}?as=grow`)
        const documentLang =
          language === "arabic-modern-standard"
            ? "ar"
            : language === "urdu"
              ? "ur"
              : "en"
        await languageBoundary(
          page.locator("html"),
          documentLang,
          documentLang === "en" ? "ltr" : "rtl",
        )
        const card = page.getByTestId("watch-grow-continue")
        const heading = card.getByRole("heading", {
          name: `Tomorrow: ${nextTitle}`,
          exact: true,
        })
        const title = heading.locator("span")
        await languageBoundary(title, "", "auto")
        await expect(title).toHaveCSS("direction", direction)
        const eyebrow = card.locator("p").first()
        await expect(eyebrow).toHaveText(`${seriesTitle} · 1 of 2`)
        await languageBoundary(eyebrow.locator("span"), "", "auto")
        await expect(eyebrow.locator("span")).toHaveCSS("direction", direction)
        for (const label of [
          heading,
          eyebrow,
          card.getByRole("img", { name: "Episode 1 of 2" }),
        ]) {
          expect(
            await label.evaluate((node) =>
              node.closest("[lang]")?.getAttribute("lang"),
            ),
          ).toBe("en")
          await expect(label).toHaveCSS("direction", "ltr")
        }
        const next = card.getByRole("link", {
          name: "Watch it now",
          exact: true,
        })
        await next.focus()
        await expect(next).toBeFocused()
        await page.keyboard.press("Enter")
        const destination =
          language === "english"
            ? `/watch/${series}.html/r4-title-second.html`
            : `/watch/${series}.html/r4-title-second/${language}.html`
        await expect(page).toHaveURL(new URL(destination, page.url()).href)

        await page.goto(`${path}?as=share`)
        const share = page.getByTestId("watch-share-ideas")
        const introduction = share.locator("header > p").last()
        await expect(introduction).toContainText(`${currentTitle} is`)
        await languageBoundary(introduction.locator("span"), "", "auto")
        await expect(introduction.locator("span")).toHaveCSS(
          "direction",
          direction,
        )
        await expect(introduction).toHaveCSS("direction", "ltr")
        const launcher = page.getByTestId("watch-share-kit-launcher")
        await launcher.click()
        const kit = page.getByTestId("watch-share-kit")
        const kitTitle = kit.getByRole("heading", {
          name: currentTitle,
          exact: true,
        })
        await languageBoundary(kitTitle, "", "auto")
        await expect(kitTitle).toHaveCSS("direction", direction)
        await expect(
          kit.getByRole("button", { name: "Close film kit", exact: true }),
        ).toHaveCSS("direction", "ltr")
        await page.keyboard.press("Escape")
        await expect(kit).toHaveCount(0)
        await expect(launcher).toBeFocused()
      })
    }

    for (const [language, documentLang, passageLang, direction, content] of [
      [
        "arabic-modern-standard",
        "ar",
        "ar",
        "rtl",
        "لأَنَّهُ هكَذَا أَحَبَّ اللهُ الْعَالَمَ",
      ],
      [
        "spanish-latin-american",
        "es-419",
        "es-419",
        "ltr",
        "Porque de tal manera amó Dios al mundo",
      ],
      // Urdu has no approved Bible version: the real producer selects English.
      ["urdu", "ur", "en", "ltr", "For God so loved the world"],
    ]) {
      test(`${language} Scripture follows the selected version in lean and full Grow`, async ({
        page,
      }) => {
        for (const full of [false, true]) {
          await page.goto(video(language, full))
          await expect(page.locator("html")).toHaveAttribute(
            "lang",
            documentLang,
          )
          const section = page.getByTestId(
            full ? "watch-grow-verse" : "watch-grow-line",
          )
          const quote = section.locator("blockquote")
          await expect(quote).toContainText(content)
          await languageBoundary(quote, passageLang, direction)
          const reference = section.locator("figcaption span[lang]")
          await languageBoundary(reference, passageLang, direction)
          const copy = section.getByRole("button", {
            name: full ? "Copy text" : "Copy",
            exact: true,
          })
          expect(
            await copy.evaluate((node) =>
              node.closest("[lang]")?.getAttribute("lang"),
            ),
          ).toBe("en")
          expect(
            await copy.evaluate((node) =>
              node.closest("[dir]")?.getAttribute("dir"),
            ),
          ).toBe("ltr")
          if (!full) {
            const expand = section.getByRole("button", {
              name: "Read the whole passage",
              exact: true,
            })
            await expand.click()
            await expect(
              section.getByRole("button", {
                name: "Hide the passage",
                exact: true,
              }),
            ).toHaveAttribute("aria-expanded", "true")
            const passage = section.locator("p[lang]")
            await expect(passage).toContainText(content)
            await languageBoundary(passage, passageLang, direction)
          }
          const panel = page.getByTestId("watch-next-steps-panel")
          expect(
            (await page.getByTestId("watch-grow").boundingBox())!.width,
          ).toBeLessThanOrEqual((await panel.boundingBox())!.width + 1)
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth - innerWidth,
            ),
          ).toBe(0)
        }
      })
    }

    test("English portals retain language, labels, keyboard containment and return focus on an Arabic page", async ({
      page,
    }) => {
      const writes: string[] = []
      page.on("request", (request) => {
        if (
          request.method() !== "GET" &&
          /learning-progress|film-finder|audience/.test(
            new URL(request.url()).pathname,
          )
        )
          writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
      })
      await page.goto(video("arabic-modern-standard"))
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
      const finder = page
        .getByRole("button", { name: "Find films for you", exact: true })
        .first()
      await finder.click()
      const flow = page.getByRole("dialog", {
        name: "Find films for you",
        exact: true,
      })
      await expect(flow).toHaveAttribute("data-step", "reasons")
      await languageBoundary(flow, "en", "ltr")
      expect(
        await flow
          .getByRole("button", { name: "Close", exact: true })
          .evaluate((node) => node.closest("[lang]")?.getAttribute("lang")),
      ).toBe("en")
      await trapFocus(page, flow)
      await page.keyboard.press("Escape")
      await expect(flow).toHaveCount(0)
      await expect(finder).toBeFocused()

      await page.goto(video("arabic-modern-standard", true))
      await page.getByTestId("watch-grow-course-start").click()
      const storyTrigger = page.getByTestId("watch-grow-course-play-story")
      await storyTrigger.click()
      const story = page.getByRole("dialog", {
        name: "Lesson 1 as a story",
        exact: true,
      })
      await languageBoundary(story, "en", "ltr")
      await trapFocus(page, story)
      const before = await story.getAttribute("data-card-id")
      await page.keyboard.press("ArrowRight")
      await expect(story).not.toHaveAttribute("data-card-id", before!)
      await page.keyboard.press("Escape")
      await expect(story).toHaveCount(0)
      await expect(storyTrigger).toBeFocused()

      for (const kind of ["subscribe", "mentor"]) {
        const trigger = page.getByTestId(`watch-grow-prayer-${kind}-open`)
        await trigger.click()
        const dialog = page.getByTestId(`watch-grow-prayer-${kind}`)
        await expect(dialog).toHaveAccessibleName(
          kind === "subscribe"
            ? "One prayer a day, sent to you"
            : "Be the person who answers",
        )
        await expect(dialog).toHaveAccessibleDescription(/not available/)
        await languageBoundary(dialog, "en", "ltr")
        // This shared control is actually translated; its own boundary stays Arabic.
        const close = dialog.getByTestId("dialog-close-button")
        await expect(close).toHaveAccessibleName("إغلاق")
        await languageBoundary(close, "ar", "rtl")
        await trapFocus(page, dialog)
        await page.keyboard.press("Escape")
        await expect(dialog).not.toBeVisible()
        await expect(trigger).toBeFocused()
      }
      expect(writes).toEqual([])
    })
  })
}
