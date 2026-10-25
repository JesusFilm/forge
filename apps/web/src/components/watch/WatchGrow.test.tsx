// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { WatchGrow } from "./WatchGrow"

const state = vi.hoisted(() => ({ imported: 0 }))
vi.mock("./WatchGrowProgressCourse", () => {
  state.imported += 1
  return {
    WatchGrowProgressCourse: () => (
      <p data-testid="deferred-course">Nine lessons ready</p>
    ),
  }
})
vi.mock("./WatchFindLauncher", () => ({
  WatchFindButton: () => <button type="button">Find films for you</button>,
}))
vi.mock("next/image", () => ({
  default: ({ fill: _fill, ...props }: Record<string, unknown>) =>
    createElement("img", props),
}))

let root: Root
let container: HTMLDivElement
async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
const citations = [
  {
    passage: {
      content:
        "Come, follow me, Jesus said, and I will send you out to fish for people. At once they left their nets and followed him.",
      humanReference: "Matthew 4:19-20",
      versionAbbreviation: "NIV",
    },
  },
] as never
function render(url: string) {
  window.history.replaceState(null, "", url)
  act(() =>
    root.render(
      <WatchGrow
        citations={citations}
        filmTitle="Fish for People"
        seriesTitle="40 Days"
        episodeCount={3}
        episodeIndex={1}
        nextEpisode={{ title: "Day 2", minutes: 4, href: "/day-2.html" }}
      />,
    ),
  )
}
beforeEach(() => {
  state.imported = 0
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it("leads with this film's next episode and one verse, without loading the course", async () => {
  render("/watch?as=grow")
  await settle()
  const grow = container.querySelector('[data-testid="watch-grow"]')!
  expect(grow.getAttribute("data-shape")).toBe("lean")
  expect(container.textContent).toContain("Tomorrow: Day 2")
  expect(container.textContent).toContain("From Matthew 4:19-20 · NIV")
  expect(container.textContent).toContain("Where does your week happen?")
  expect(container.textContent).toContain("Find films for you")
  expect(container.querySelector('a[href="?as=grow&grow=full"]')).not.toBeNull()
  expect(state.imported).toBe(0)
})

it("omits film modules honestly when the film has no series or passage", async () => {
  window.history.replaceState(null, "", "/watch?as=grow")
  act(() => root.render(<WatchGrow />))
  await settle()
  expect(container.textContent).not.toContain("Tomorrow:")
  expect(container.textContent).not.toContain("One line to carry")
  expect(container.textContent).toContain("Where does your week happen?")
})

it("shows the long shelf in the original order and loads the course there", async () => {
  render("/watch?as=grow&grow=full")
  await settle()
  const grow = container.querySelector('[data-testid="watch-grow"]')!
  expect(grow.getAttribute("data-shape")).toBe("full")
  const order = [
    "watch-grow-verse",
    "deferred-course",
    "watch-grow-steps",
    "watch-grow-plans",
    "watch-grow-prayer",
  ].map((id) => container.querySelector(`[data-testid="${id}"]`))
  expect(order.every(Boolean)).toBe(true)
  for (let i = 1; i < order.length; i++) {
    expect(
      order[i - 1]!.compareDocumentPosition(order[i]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  }
  expect(state.imported).toBe(1)
})

it("lands a sign-in return to a lesson on the long shelf", async () => {
  render("/watch?as=grow&growLesson=lesson-3")
  await settle()
  expect(
    container
      .querySelector('[data-testid="watch-grow"]')!
      .getAttribute("data-shape"),
  ).toBe("full")
})

it("shows the film's place in its series without claiming episodes were watched", async () => {
  window.history.replaceState(null, "", "/watch?as=grow")
  act(() =>
    root.render(
      <WatchGrow
        seriesTitle="40 Days"
        episodeCount={9}
        episodeIndex={3}
        nextEpisode={{ title: "Day 4", minutes: 4, href: "/day-4.html" }}
      />,
    ),
  )
  await settle()
  const card = container.querySelector('[data-testid="watch-grow-continue"]')!
  expect(card.textContent).toContain("40 Days · 3 of 9")
  expect(card.textContent).not.toMatch(/done|watched/i)
  const bar = card.querySelector('[role="img"]')!
  expect(bar.getAttribute("aria-label")).toBe("Episode 3 of 9")
  expect(bar.querySelectorAll(".bg-brand-red")).toHaveLength(1)
  expect(bar.children[2]!.className).toContain("bg-brand-red")
})

it.each([
  ["مسيرة المسيح", "بداية الخدمة"],
  ["The Life of Jesus", "Ministry begins"],
  [null, "Title without locale metadata"],
])(
  "isolates continuation titles %s from surrounding English labels",
  (seriesTitle, title) => {
    document.documentElement.lang = "ar"
    document.documentElement.dir = "rtl"
    try {
      window.history.replaceState(null, "", "/watch?as=grow")
      act(() =>
        root.render(
          <div lang="en" dir="ltr">
            <WatchGrow
              seriesTitle={seriesTitle}
              episodeCount={3}
              episodeIndex={1}
              nextEpisode={{ title, minutes: 4, href: "/watch/next.html" }}
            />
          </div>,
        ),
      )
      const card = container.querySelector(
        '[data-testid="watch-grow-continue"]',
      )!
      const heading = card.querySelector("h2")!
      expect(heading.textContent).toBe(`Tomorrow: ${title}`)
      const selectedTitle = heading.querySelector("span")!
      expect(selectedTitle?.textContent).toBe(title)
      expect(selectedTitle?.getAttribute("lang")).toBe("")
      expect(selectedTitle?.getAttribute("dir")).toBe("auto")
      const eyebrow = card.querySelector("p")!
      if (seriesTitle) {
        expect(eyebrow.querySelector("span")?.textContent).toBe(seriesTitle)
        expect(eyebrow.querySelector("span")?.getAttribute("lang")).toBe("")
        expect(eyebrow.querySelector("span")?.getAttribute("dir")).toBe("auto")
      } else {
        expect(eyebrow.textContent).toBe("Keep going · 1 of 3")
        expect(eyebrow.querySelector("span")).toBeNull()
      }
      for (const label of [
        heading,
        eyebrow,
        card.querySelector("a")!,
        card.querySelector('[role="img"]')!,
      ]) {
        expect(label.closest("[lang]")?.getAttribute("lang")).toBe("en")
        expect(label.closest("[dir]")?.getAttribute("dir")).toBe("ltr")
      }
    } finally {
      document.documentElement.removeAttribute("lang")
      document.documentElement.removeAttribute("dir")
    }
  },
)

it.each([
  [
    "arabic-modern-standard",
    "ar",
    "rtl",
    "لأَنَّهُ هكَذَا أَحَبَّ اللهُ الْعَالَمَ.",
  ],
  [
    "spanish-latin-american",
    "es-419",
    "ltr",
    "Porque de tal manera amó Dios al mundo.",
  ],
  ["english", "en", "ltr", "For God so loved the world."],
  [undefined, "", "auto", "Text without language metadata."],
  ["unmapped-language", "", "auto", "Text with unknown language metadata."],
])(
  "isolates %s Scripture in both Grow shapes from English resources on an Arabic document",
  async (languageSlug, lang, dir, content) => {
    document.documentElement.lang = "ar"
    document.documentElement.dir = "rtl"
    try {
      for (const shape of ["lean", "full"]) {
        window.history.replaceState(
          null,
          "",
          `/watch?as=grow${shape === "full" ? "&grow=full" : ""}`,
        )
        const localized = [
          {
            passage: {
              content,
              languageSlug,
              humanReference: "Localized reference",
              versionAbbreviation: "VERSION",
            },
          },
        ] as never
        await act(async () =>
          root.render(
            <div lang="en" dir="ltr">
              <WatchGrow citations={localized} />
            </div>,
          ),
        )
        await settle()
        const quote = container.querySelector("blockquote")!
        expect(quote.textContent).toBe(content)
        expect(quote.getAttribute("lang")).toBe(lang)
        expect(quote.getAttribute("dir")).toBe(dir)
        const credit = container.querySelector("figcaption")!
        const reference = credit.querySelector("[lang]") ?? credit
        expect(reference.getAttribute("lang")).toBe(lang)
        expect(reference.getAttribute("dir")).toBe(dir)
        const copy = [...container.querySelectorAll("button")].find((button) =>
          button.textContent?.includes("Copy"),
        )!
        expect(copy.closest("[lang]")?.getAttribute("lang")).toBe("en")
        expect(copy.closest("[dir]")?.getAttribute("dir")).toBe("ltr")
        if (shape === "lean") {
          await act(async () =>
            [...container.querySelectorAll("button")]
              .find((button) =>
                button.textContent?.includes("Read the whole passage"),
              )!
              .click(),
          )
          const expanded = [...container.querySelectorAll("p")].find(
            (p) => p.textContent === content,
          )!
          expect(expanded.getAttribute("lang")).toBe(lang)
          expect(expanded.getAttribute("dir")).toBe(dir)
        }
        // Reset the full-shape latch before the next case/shape.
        await act(async () => root.render(null))
      }
    } finally {
      document.documentElement.removeAttribute("lang")
      document.documentElement.removeAttribute("dir")
    }
  },
)
