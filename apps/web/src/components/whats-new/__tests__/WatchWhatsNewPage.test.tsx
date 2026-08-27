/**
 * @vitest-environment jsdom
 */

import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { setRequestLocale } from "next-intl/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WatchWhatsNewPage } from "@/components/whats-new/WatchWhatsNewPage"
import {
  WHATS_NEW_ASSISTANTS,
  WHATS_NEW_AUDIENCES,
  WHATS_NEW_CONTENTS,
  WHATS_NEW_FORMATS,
  WHATS_NEW_DIRECTIONS,
  WHATS_NEW_ERAS,
  WHATS_NEW_FAQ,
  WHATS_NEW_HERO,
  WHATS_NEW_ICEBERG,
  WHATS_NEW_IMPROVEMENTS,
  WHATS_NEW_LEDE,
  WHATS_NEW_TEAM,
} from "@/components/whats-new/whats-new-content"
import { WHATS_NEW_LANGUAGE_SWITCHER } from "@/components/whats-new/whats-new-content"
import { WATCH_FEEDBACK_OPEN_EVENT } from "@/lib/watch-feedback-events"

const { routerPushMock } = vi.hoisted(() => ({ routerPushMock: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}))

// The real combobox portals into document.body and virtualizes; the page
// suite only needs to see that it is mounted and wired.
vi.mock("@/components/watch/LanguageCombobox", () => ({
  LanguageCombobox: ({
    options,
    value,
  }: {
    options: Array<{ slug: string }>
    value: string
  }) => (
    <button
      type="button"
      data-testid="language-combobox-mock"
      data-option-slugs={options.map((option) => option.slug).join(",")}
      data-value={value}
    />
  ),
}))

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode
    href: string
  } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
    className,
  }: {
    alt: string
    src: string
    className?: string
  }) =>
    // `createElement` rather than JSX: an `<img>` literal trips
    // `@next/next/no-img-element`, and that rule is not resolvable when
    // lint-staged runs eslint on this file outside the app's Next config,
    // so a disable comment errors there instead of silencing anything.
    createElement("img", { alt, src, className }),
}))

const LANGUAGES = [
  {
    slug: "english",
    languageName: "English",
    nativeName: "English",
    bcp47: "en",
  },
  {
    slug: "russian",
    languageName: "Russian",
    nativeName: "Русский",
    bcp47: "ru",
  },
  {
    slug: "spanish-latin-american",
    languageName: "Spanish, Latin American",
    nativeName: "Español",
    bcp47: "es-419",
  },
]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  setRequestLocale("en")
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <WatchWhatsNewPage languageSlug="english" languages={LANGUAGES} />,
    )
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function textContent() {
  return container.textContent ?? ""
}

describe("WatchWhatsNewPage", () => {
  it("renders one h1 carrying the announcement title", () => {
    const headings = container.querySelectorAll("h1")
    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe(WHATS_NEW_HERO.title)
  })

  it("keeps a linear heading outline with no skipped levels", () => {
    const levels = [
      ...container.querySelectorAll("h1, h2, h3, h4, h5, h6"),
    ].map((node) => Number(node.tagName.slice(1)))

    expect(levels[0]).toBe(1)
    for (const [index, level] of levels.entries()) {
      if (index === 0) continue
      expect(level - levels[index - 1]).toBeLessThanOrEqual(1)
    }
  })

  const cards = () => [
    ...container.querySelectorAll('[data-testid="whats-new-era-card"]'),
  ]
  const beats = () => [
    ...container.querySelectorAll('[data-testid="whats-new-era-beat"]'),
  ]

  it("tells the discovery arc in order: projector, tape, web, conversation", () => {
    expect(
      cards().map((card) => card.querySelector("h3")?.textContent),
    ).toEqual(WHATS_NEW_ERAS.map((era) => era.title))
    for (const [index, card] of cards().entries()) {
      expect(card.textContent).toContain(WHATS_NEW_ERAS[index].kicker)
      expect(card.textContent).toContain(WHATS_NEW_ERAS[index].body)
    }
  })

  it("labels the timeline with year milestones, in order", () => {
    const years = [
      ...container.querySelectorAll('[data-testid="whats-new-year"]'),
    ]

    expect(years.map((year) => year.textContent)).toEqual(
      WHATS_NEW_ERAS.map((era) => era.year),
    )
    // Every milestone is also on its card, so the stack is readable
    // without glancing back up at the rail.
    for (const [index, card] of cards().entries()) {
      expect(card.textContent).toContain(WHATS_NEW_ERAS[index].year)
    }
  })

  it("stacks the eras in source order, back to front", () => {
    const layers = [
      ...container.querySelectorAll('[data-testid="whats-new-era"]'),
    ].map((card) =>
      Number(card.getAttribute("style")?.match(/--layer:\s*(\d+)/)?.[1]),
    )

    expect(layers).toEqual(WHATS_NEW_ERAS.map((_, index) => index + 1))
  })

  it("gives every era a scroll slice that starts where the last one did not", () => {
    const starts = cards().map((card) =>
      Number(
        card
          .getAttribute("style")
          ?.match(/--enter-range:\s*contain ([\d.]+)%/)?.[1],
      ),
    )

    expect(starts).toHaveLength(WHATS_NEW_ERAS.length)
    expect(starts[0]).toBe(0)
    for (const [index, start] of starts.entries()) {
      if (index === 0) continue
      expect(start).toBeGreaterThan(starts[index - 1])
    }
  })

  it("never dims or drops the era the reader is left on", () => {
    // The last card must not recede and the last beat must not fade: both
    // ranges deliberately start past the end of the stage. Get this wrong
    // and the section finishes on a dimmed card under empty text.
    const lastCard = cards().at(-1)?.getAttribute("style") ?? ""
    const lastBeat = beats().at(-1)?.getAttribute("style") ?? ""

    const recedeStart = Number(
      lastCard.match(/--recede-range:\s*contain ([\d.]+)%/)?.[1],
    )
    const beatEnd = Number(
      lastBeat.match(/--beat-range:\s*contain [\d.]+% contain ([\d.]+)%/)?.[1],
    )

    expect(recedeStart).toBeGreaterThan(100)
    expect(beatEnd).toBeGreaterThan(100)
  })

  it("does dim and drop every era before the last one", () => {
    // Anti-vacuous companion: if every card were given an out-of-range
    // recede the stack would never reveal what is underneath it.
    for (const card of cards().slice(0, -1)) {
      const recedeStart = Number(
        card
          .getAttribute("style")
          ?.match(/--recede-range:\s*contain ([\d.]+)%/)?.[1],
      )
      expect(recedeStart).toBeLessThan(100)
    }
  })

  it("gives every era with a photo a photo, and the rest the rendered panel", () => {
    for (const [index, card] of cards().entries()) {
      const source = WHATS_NEW_ERAS[index]
      const image = "image" in source ? source.image : undefined
      const rendered = card.querySelector("img")

      if (image) {
        expect(rendered?.getAttribute("src"), source.title).toBe(image.src)
        expect(rendered?.getAttribute("alt"), source.title).toBe(image.alt)
        // The photo carries the argument, so it is content, not decoration.
        expect(image.alt.length, source.title).toBeGreaterThan(20)
      } else {
        expect(rendered, source.title).toBeNull()
        expect(card.querySelector("svg"), source.title).not.toBeNull()
      }
    }
  })

  it("leaves the era that has not happened yet unphotographed", () => {
    const current = cards().filter((card) => card.hasAttribute("data-current"))

    expect(current).toHaveLength(1)
    expect(current[0]).toBe(cards().at(-1))
    expect(current[0].querySelector("img")).toBeNull()
  })

  it("layers grain twice over each media slot and once over the stage", () => {
    for (const [index, card] of cards().entries()) {
      const label = WHATS_NEW_ERAS[index].title
      expect(card.querySelectorAll(".watch-grain"), label).toHaveLength(1)
      expect(card.querySelectorAll(".watch-grain-fine"), label).toHaveLength(1)
    }
    // Grain belongs to the cards and nowhere else — a section-wide haze
    // reads as a dirty background rather than film on the picture.
    expect(container.querySelectorAll(".watch-grain")).toHaveLength(
      WHATS_NEW_ERAS.length,
    )
    for (const grain of container.querySelectorAll(
      ".watch-grain, .watch-grain-fine",
    )) {
      expect(
        grain.closest('[data-testid="whats-new-era-card"]'),
        grain.getAttribute("class") ?? "",
      ).not.toBeNull()
    }
  })

  it("threads a narrative beat for every era card", () => {
    // "Mix text and cards": the text under the stack swaps with the card
    // above it. A beat that stops rendering silently drops a third of the
    // section's prose.
    expect(beats()).toHaveLength(WHATS_NEW_ERAS.length)
    for (const [index, beat] of beats().entries()) {
      expect(beat.textContent).toBe(WHATS_NEW_ERAS[index].beat)
    }
  })

  it("pins the stage and sizes it from the era count", () => {
    const stage = container.querySelector('[data-testid="whats-new-eras"]')

    // The stage height is `--era-count * 92svh + 34svh`; a missing count
    // collapses the pin and the stack never gets scroll distance.
    expect(stage?.getAttribute("style")).toContain(
      `--era-count: ${WHATS_NEW_ERAS.length}`,
    )
    expect(stage?.className).toContain("watch-scroll-stage")
    expect(stage?.querySelector(".watch-scroll-pin")).not.toBeNull()
  })

  it("shows the first era without animating it in", () => {
    // The section opens with this card already on screen. Fading it up
    // from nothing leaves the reader looking at empty black, which reads
    // as a page that failed to load — the exact bug this guards.
    const layers = [
      ...container.querySelectorAll('[data-testid="whats-new-era"]'),
    ]
    const beats = [
      ...container.querySelectorAll('[data-testid="whats-new-era-beat"]'),
    ]
    const glows = [
      ...container.querySelectorAll('[data-testid="whats-new-era-glow"]'),
    ]

    expect(
      layers[0].querySelector('[data-testid="whats-new-era-card"]')?.className,
    ).not.toContain("watch-scroll-era-in")
    expect(beats[0].className).toContain("watch-scroll-beatbox-lead")
    expect(glows[0].className).toContain("watch-ambient-lead")
  })

  it("does animate in every era after the first", () => {
    // Anti-vacuous companion: skipping the entrance everywhere would
    // satisfy the check above and delete the stack effect entirely.
    const layers = [
      ...container.querySelectorAll('[data-testid="whats-new-era"]'),
    ]

    for (const layer of layers.slice(1)) {
      expect(
        layer.querySelector('[data-testid="whats-new-era-card"]')?.className,
      ).toContain("watch-scroll-era-in")
    }
    expect(layers.length).toBeGreaterThan(1)
  })

  it("piles receded cards at descending depths", () => {
    // Every card sinking to the same place would hide the pile: only one
    // card would ever be visible behind the front one.
    const sinks = [
      ...container.querySelectorAll('[data-testid="whats-new-era"]'),
    ].map((layer) =>
      Number(
        layer.getAttribute("style")?.match(/--sink-y:\s*(-?[\d.]+)rem/)?.[1],
      ),
    )

    expect(sinks).toHaveLength(WHATS_NEW_ERAS.length)
    expect(sinks.at(-1)).toBe(0)
    for (const [index, sink] of sinks.entries()) {
      if (index === 0) continue
      expect(sink).toBeGreaterThan(sinks[index - 1])
    }
  })

  it("gives every era an ambient glow sampled from its own art", () => {
    const glows = [
      ...container.querySelectorAll('[data-testid="whats-new-era-glow"]'),
    ]

    expect(glows).toHaveLength(WHATS_NEW_ERAS.length)
    const colours = glows.map(
      (glow) =>
        glow.getAttribute("style")?.match(/--glow:\s*(#[0-9a-f]{6})/i)?.[1],
    )
    expect(colours).toEqual(WHATS_NEW_ERAS.map((era) => era.glow))
    // Distinct per era — one shared colour is not "from the picture".
    expect(new Set(colours).size).toBe(WHATS_NEW_ERAS.length)
  })

  it("puts each beat above the card it introduces", () => {
    // Pinned, a beat placed under the stack lands at the foot of the
    // viewport and gets cut off. Above the card it also reads better: the
    // text introduces the era the card then shows.
    for (const layer of container.querySelectorAll(
      '[data-testid="whats-new-era"]',
    )) {
      const order = [
        ...layer.querySelectorAll(
          '[data-testid="whats-new-era-beat"], [data-testid="whats-new-era-clip"]',
        ),
      ].map((node) => node.getAttribute("data-testid"))

      expect(order).toEqual(["whats-new-era-beat", "whats-new-era-clip"])
    }
  })

  it("clips each card so it can travel opaque", () => {
    // The incoming card slides over the one below it. If it faded in
    // instead, the previous photograph would show straight through it and
    // the deck would stop reading as a deck. The clip box is what makes an
    // opacity ramp unnecessary — losing it silently brings the ghosting
    // back, because the card would then be visible for its whole travel.
    const clips = [
      ...container.querySelectorAll('[data-testid="whats-new-era-clip"]'),
    ]

    expect(clips).toHaveLength(WHATS_NEW_ERAS.length)
    for (const clip of clips) {
      expect(clip.className).toContain("overflow-hidden")
      // The sink rides the clip box, not the card: a pile offset applied
      // inside the clip would be cropped by it.
      expect(clip.className).toContain("watch-scroll-sink")
      expect(
        clip.querySelector('[data-testid="whats-new-era-card"]'),
      ).not.toBeNull()
    }
  })

  it("keeps every piece of card chrome on the card, not the clip box", () => {
    // An outline on the stationary clip box turns the effect inside out:
    // the frame stays put and the picture appears to slide around inside
    // it, instead of a whole card travelling. The border is the tell.
    const clips = [
      ...container.querySelectorAll('[data-testid="whats-new-era-clip"]'),
    ]

    for (const clip of clips) {
      expect(clip.className).not.toMatch(/\bborder\b/)
      const card = clip.querySelector('[data-testid="whats-new-era-card"]')
      expect(card?.className).toMatch(/\bborder\b/)
      // Opaque, so the card underneath never shows through mid-travel.
      expect(card?.className).toMatch(/\bbg-/)
    }
  })

  it("nests each beat inside its own era layer", () => {
    // Load-bearing for the fallback: without support for scroll-driven
    // animations the layers never leave the flow, and only this nesting
    // makes that render as an interleaved card-then-beat list rather than
    // four cards followed by four orphaned paragraphs.
    const layers = [
      ...container.querySelectorAll('[data-testid="whats-new-era"]'),
    ]

    expect(layers).toHaveLength(WHATS_NEW_ERAS.length)
    for (const [index, layer] of layers.entries()) {
      expect(
        layer.querySelectorAll('[data-testid="whats-new-era-card"]'),
      ).toHaveLength(1)
      const beat = layer.querySelector('[data-testid="whats-new-era-beat"]')
      expect(beat?.textContent, WHATS_NEW_ERAS[index].title).toBe(
        WHATS_NEW_ERAS[index].beat,
      )
    }
  })

  it("drives stack, scrim, beat, and year rail from the stage timeline", () => {
    const counts = {
      ".watch-scroll-era": WHATS_NEW_ERAS.length,
      ".watch-scroll-sink": WHATS_NEW_ERAS.length,
      '[data-testid="whats-new-era-clip"]': WHATS_NEW_ERAS.length,
      ".watch-scroll-scrim": WHATS_NEW_ERAS.length,
      ".watch-scroll-beatbox": WHATS_NEW_ERAS.length,
      ".watch-scroll-year": WHATS_NEW_ERAS.length,
      ".watch-scroll-year-fill": 1,
    }

    for (const [selector, expected] of Object.entries(counts)) {
      expect(container.querySelectorAll(selector), selector).toHaveLength(
        expected,
      )
    }
  })

  it("keeps every delivery era in the argument", () => {
    // The section's whole claim is that Watch has followed the medium
    // since before the web, and is doing it again. A rewrite that drops
    // any beat — the projector, the tape, the pre-YouTube web, Google, or
    // the assistant — collapses the argument into a feature announcement.
    const argument = [
      ...WHATS_NEW_ERAS.map((era) => era.beat),
      WHATS_NEW_LEDE.closing,
    ].join(" ")

    for (const token of [
      "projectors",
      "VHS",
      "DVD",
      "YouTube",
      "Google",
      "ChatGPT",
    ]) {
      expect(argument, token).toContain(token)
    }
    expect(textContent()).toContain(WHATS_NEW_LEDE.closing)
  })

  it("opens the stage with the screening paragraph, above its own card", () => {
    // Each beat has to describe the card directly beneath it. The opening
    // paragraph belongs to the projector era, not to the section header —
    // one place out of step and every beat afterwards describes the wrong
    // card, which no other assertion here would notice.
    const layers = [
      ...container.querySelectorAll('[data-testid="whats-new-era"]'),
    ]

    expect(
      layers[0].querySelector('[data-testid="whats-new-era-beat"]')
        ?.textContent,
    ).toContain("It began as a screening")
    expect(layers[0].querySelector("h3")?.textContent).toBe(
      "A projector and a screen",
    )

    // …and the closing line is out of the stage entirely, after it.
    const closing = container.querySelector(
      '[data-testid="whats-new-lede-closing"]',
    )
    expect(closing?.textContent).toBe(WHATS_NEW_LEDE.closing)
    expect(closing?.closest('[data-testid="whats-new-eras"]')).toBeNull()
  })

  it("threads a narrative beat after every era card", () => {
    // "Mix text and cards": each era's card is followed by the paragraph
    // that carries the argument on to the next one. A beat that stops
    // rendering would silently drop a third of the section's prose.
    const beats = [
      ...container.querySelectorAll('[data-testid="whats-new-era-beat"]'),
    ]

    expect(beats).toHaveLength(WHATS_NEW_ERAS.length)
    for (const [index, beat] of beats.entries()) {
      expect(beat.textContent).toBe(WHATS_NEW_ERAS[index].beat)
    }
  })

  it("orders the era spine oldest to newest", () => {
    // Reordering the array would silently reverse the argument's arc while
    // every other assertion here still passed.
    expect(WHATS_NEW_ERAS.map((era) => era.title)).toEqual([
      "A projector and a screen",
      "Cassettes and discs",
      "Online before YouTube",
      "Answers in conversation",
    ])
  })

  it("lays the improvements out as a quadrant grid with screenshots", () => {
    const cards = [
      ...container.querySelectorAll(
        '[data-testid="whats-new-improvement-card"]',
      ),
    ]

    expect(cards).toHaveLength(WHATS_NEW_IMPROVEMENTS.length)
    expect(cards[0].parentElement?.className).toMatch(/\bgrid\b/)
    for (const [index, card] of cards.entries()) {
      const shot = card.querySelector("img")
      expect(
        shot?.getAttribute("src"),
        WHATS_NEW_IMPROVEMENTS[index].title,
      ).toBe(WHATS_NEW_IMPROVEMENTS[index].shot.src)
      // The shot carries the point, so it is content, not decoration.
      expect(shot?.getAttribute("alt")?.length ?? 0).toBeGreaterThan(20)
    }
  })

  it("keeps the improvements numbered in source order", () => {
    const cards = [
      ...container.querySelectorAll(
        '[data-testid="whats-new-improvement-card"]',
      ),
    ]

    expect(cards.map((card) => card.querySelector("h3")?.textContent)).toEqual(
      WHATS_NEW_IMPROVEMENTS.map((item) => item.title),
    )
    expect(
      cards.map(
        (card) =>
          card.querySelector("span.tabular-nums")?.textContent ??
          [...card.querySelectorAll("span")]
            .map((s) => s.textContent)
            .find((t) => /^0\d$/.test(t ?? "")),
      ),
    ).toEqual(["01", "02", "03", "04", "05"])
  })

  it("puts the divider only on right-hand cells", () => {
    // The language cell spans the full row, so a naive index parity would
    // draw the column rule down the middle of the wrong cards.
    const cards = [
      ...container.querySelectorAll(
        '[data-testid="whats-new-improvement-card"]',
      ),
    ]
    const dividers = cards.map((card) => card.className.includes("lg:border-l"))

    expect(dividers).toEqual([false, true, false, false, true])
    expect(cards[2].className).toContain("lg:col-span-2")
  })

  it("singles out the language card among the plain ones", () => {
    const featured = [
      ...container.querySelectorAll(
        '[data-testid="whats-new-improvement-card"]',
      ),
    ].filter((card) => card.hasAttribute("data-featured"))

    expect(featured).toHaveLength(1)
    expect(featured[0].querySelector("h3")?.textContent).toBe(
      WHATS_NEW_IMPROVEMENTS.find((item) => item.featured)?.title,
    )
  })

  it("renders every improvement, its bullets, and its closing line", () => {
    for (const item of WHATS_NEW_IMPROVEMENTS) {
      expect(textContent()).toContain(item.title)
      for (const point of item.points) {
        expect(textContent()).toContain(point)
      }
      if ("closing" in item && item.closing) {
        expect(textContent()).toContain(item.closing)
      }
    }
  })

  it("renders the audience, direction, and team copy in full", () => {
    for (const card of WHATS_NEW_AUDIENCES.cards) {
      expect(textContent()).toContain(card.title)
      expect(textContent()).toContain(card.body)
    }
    for (const item of WHATS_NEW_DIRECTIONS.items) {
      expect(textContent()).toContain(item)
    }
    for (const note of WHATS_NEW_DIRECTIONS.notes) {
      expect(textContent()).toContain(note)
    }
    for (const contribution of WHATS_NEW_TEAM.contributions) {
      expect(textContent()).toContain(contribution)
    }
  })

  it("never gives a decorative icon a per-stroke alpha", () => {
    // Lucide icons are multi-path stroke drawings, so a fractional colour
    // utility (`text-white/20`) composites EVERY crossing twice and the
    // seams show. Alpha belongs on element `opacity`, which flattens the
    // SVG into one compositing group before making it transparent.
    const perStrokeAlpha = /\btext-[a-z]+(?:-\d+)?\/(?:\d+|\[)/

    const offenders = [
      ...container.querySelectorAll<SVGElement>("svg[aria-hidden]"),
    ]
      .map((icon) => icon.getAttribute("class") ?? "")
      .filter((className) => perStrokeAlpha.test(className))

    expect(offenders).toEqual([])
  })

  it("gives every decorative icon a flattened group opacity", () => {
    // Anti-vacuous companion: the guard above passes trivially if the
    // icons stop being transparent at all, or stop rendering.
    const icons = [
      ...container.querySelectorAll<SVGElement>("svg[aria-hidden]"),
    ].filter((icon) => /\bopacity-/.test(icon.getAttribute("class") ?? ""))

    expect(icons.length).toBeGreaterThan(0)
    for (const icon of icons) {
      const className = icon.getAttribute("class") ?? ""
      // Solid colour + element opacity. The pairing is the point: the
      // colour must carry no alpha of its own, or it is per-stroke again.
      expect(className, className).toMatch(/\btext-\S+/)
      expect(className, className).not.toMatch(
        /\btext-[a-z]+(?:-\d+)?\/(?:\d+|\[)/,
      )
    }
  })

  it("fans the audience cards outward from a shared pivot", () => {
    const cards = [
      ...container.querySelectorAll('[data-testid="whats-new-audience-card"]'),
    ]

    expect(cards).toHaveLength(WHATS_NEW_AUDIENCES.cards.length)
    const rotations = cards.map((card) =>
      Number(
        card.getAttribute("style")?.match(/--fan-rotate:\s*(-?[\d.]+)deg/)?.[1],
      ),
    )
    // Ascending through zero: the middle card stays square and the outer
    // two swing opposite ways. All one sign would be a tilt, not a fan.
    expect(rotations[0]).toBeLessThan(0)
    expect(rotations[1]).toBe(0)
    expect(rotations[2]).toBeGreaterThan(0)
    for (const card of cards) {
      expect(card.className).toContain("watch-scroll-fan")
    }
  })

  it("fills each card with its colour and blends where they overlap", () => {
    const cards = [
      ...container.querySelectorAll('[data-testid="whats-new-audience-card"]'),
    ]

    for (const card of cards) {
      // A part-transparent card lets the one BEHIND it show through its
      // own copy — that reads as a stray border line struck through the
      // text, not as a blend. The fill has to be opaque; the overlap
      // effect comes from the blend mode instead.
      expect(card.className).toMatch(/bg-\[linear-gradient/)
      expect(card.className).not.toMatch(/bg-\w+\/\d/)
      expect(card.className).toContain("mix-blend-screen")
    }
    // Blending is scoped to the card group, not the section behind it.
    expect(cards[0].parentElement?.className).toContain("isolate")
  })

  it("gathers the cards inward until they overlap", () => {
    const dirs = [
      ...container.querySelectorAll('[data-testid="whats-new-audience-card"]'),
    ].map((card) =>
      Number(card.getAttribute("style")?.match(/--fan-dir:\s*(-?\d+)/)?.[1]),
    )

    // Outer cards travel toward the centre from opposite sides; the middle
    // one holds. All one sign would slide the row rather than gather it.
    expect(dirs).toEqual([-1, 0, 1])
  })

  it("sizes the gather in absolute units, not card width", () => {
    // Clearance between one card's copy and the next card's edge is
    // `padding - overlap`. The padding is fixed, so a percentage-of-width
    // travel closes that gap to nothing on a wide viewport — it measured
    // 4px at 1440. The distance lives in CSS in rem instead.
    for (const card of container.querySelectorAll(
      '[data-testid="whats-new-audience-card"]',
    )) {
      const style = card.getAttribute("style") ?? ""
      expect(style).not.toMatch(/--fan-(open|closed)-x/)
      expect(style).toMatch(/--fan-dir/)
    }
  })

  it("stacks the gathered hand left over right", () => {
    // The copy is left-aligned. Stacking the other way would put each
    // card's right neighbour on top of the start of its lines.
    const layers = [
      ...container.querySelectorAll('[data-testid="whats-new-audience-card"]'),
    ].map((card) =>
      Number(card.getAttribute("style")?.match(/--fan-layer:\s*(\d+)/)?.[1]),
    )

    for (const [index, layer] of layers.entries()) {
      if (index === 0) continue
      expect(layer).toBeLessThan(layers[index - 1])
    }
  })

  it("gives each audience its own colour and icon", () => {
    const cards = [
      ...container.querySelectorAll('[data-testid="whats-new-audience-card"]'),
    ]
    const tints = cards.map(
      (card) =>
        card.getAttribute("style")?.match(/--tint:\s*(#[0-9a-f]{6})/i)?.[1],
    )

    expect(tints).toEqual(WHATS_NEW_AUDIENCES.cards.map((card) => card.tint))
    // Distinct hues — one shared colour is not "colourful".
    expect(new Set(tints).size).toBe(cards.length)
    for (const card of cards) {
      expect(card.querySelector("svg")).not.toBeNull()
    }
  })

  it("illustrates the team section with a labelled iceberg", () => {
    const berg = container.querySelector('[data-testid="whats-new-iceberg"]')

    expect(berg).not.toBeNull()
    expect(
      berg?.closest("section")?.getAttribute("id"),
      "the iceberg belongs to the team section, not a neighbouring one",
    ).toBe("team")

    // The argument only lands if BOTH halves are named: a tip on its own
    // is just an icon.
    expect(berg?.textContent).toContain(WHATS_NEW_ICEBERG.tip)
    expect(berg?.textContent).toContain(WHATS_NEW_ICEBERG.mass)
    // Described for anyone who cannot see it.
    expect(berg?.querySelector("svg")?.getAttribute("role")).toBe("img")
    expect(berg?.querySelector("svg")?.getAttribute("aria-label")).toBe(
      WHATS_NEW_ICEBERG.alt,
    )
  })

  it("hides the submerged mass only where the reveal can run", () => {
    // `clip-path: inset(0 0 100% 0)` is the start state. If it were applied
    // outside the scroll-driven guard, a browser without support would
    // render the iceberg as a tip floating above an empty waterline.
    const submerged = container.querySelector(
      '[data-testid="whats-new-iceberg"] .watch-scroll-berg',
    )

    expect(submerged).not.toBeNull()
    expect(submerged?.getAttribute("style") ?? "").not.toContain("clip-path")
  })

  it("draws the whole delivery arc as one diagram, reel to assistant", () => {
    const steps = [
      ...container.querySelectorAll('[data-testid="whats-new-format-step"]'),
    ]

    expect(steps).toHaveLength(WHATS_NEW_FORMATS.length)
    expect(
      steps.map(
        (step) => step.querySelector("span")?.nextElementSibling?.textContent,
      ),
    ).toEqual(WHATS_NEW_FORMATS.map((format) => format.label))
    // Every step draws a real glyph, not a missing-key blank.
    for (const [index, step] of steps.entries()) {
      expect(
        step.querySelectorAll("svg path, svg circle, svg ellipse, svg rect")
          .length,
        WHATS_NEW_FORMATS[index].label,
      ).toBeGreaterThan(0)
    }
  })

  it("marks only the last format as the one still being built", () => {
    const steps = [
      ...container.querySelectorAll('[data-testid="whats-new-format-step"]'),
    ]
    const terminal = steps.filter((step) => step.hasAttribute("data-terminal"))

    // The accent belongs to the step still being built — the last one, and
    // only that one.
    expect(terminal).toHaveLength(1)
    expect(terminal[0]).toBe(steps.at(-1))
  })

  it("keeps the diagram glyphs free of per-stroke alpha", () => {
    // Same trap as the era icons: these marks are drawn from many
    // overlapping paths, so a fractional colour utility on the SVG would
    // light up every crossing. Colour belongs on the parent.
    for (const svg of container.querySelectorAll(
      '[data-testid="whats-new-format-step"] svg',
    )) {
      expect(svg.getAttribute("class") ?? "").not.toMatch(
        /\btext-[a-z]+(?:-\d+)?\/(?:\d+|\[)/,
      )
      expect(svg.getAttribute("stroke")).toBe("currentColor")
    }
  })

  it("closes on the white shelf: stickers, then FAQ, then nothing", () => {
    // Both blocks ask the reader for something, and both are light. Anything
    // slotted between them — or after the FAQ — puts a dark band back in the
    // middle of the shelf and the hand-off to the white footer is gone.
    const bands = [
      ...container.querySelectorAll(
        '[data-testid="whats-new-vote"], [data-testid="whats-new-faq"]',
      ),
    ]

    expect(bands.map((band) => band.getAttribute("data-testid"))).toEqual([
      "whats-new-vote",
      "whats-new-faq",
    ])
    expect(bands[0].nextElementSibling).toBe(bands[1])
    expect(bands[1].nextElementSibling).toBeNull()
    for (const band of bands) {
      expect(band.className).toContain("bg-white")
    }
  })

  it("publishes the FAQ as FAQPage structured data", () => {
    // This page's own argument is that discovery is moving to search and
    // assistants. Its answers should be legible to both, not only to a
    // reader who expands the rows.
    const script = container.querySelector('script[type="application/ld+json"]')
    expect(script).not.toBeNull()

    const data = JSON.parse(script?.textContent ?? "{}")
    expect(data["@type"]).toBe("FAQPage")
    expect(data.mainEntity).toHaveLength(WHATS_NEW_FAQ.items.length)
    expect(data.mainEntity[0].name).toBe(WHATS_NEW_FAQ.items[0].question)
    expect(data.mainEntity[0].acceptedAnswer.text).toBe(
      WHATS_NEW_FAQ.items[0].answer,
    )
  })

  it("anchors every on-page nav link to a section that exists", () => {
    const anchors = [
      ...container.querySelectorAll<HTMLAnchorElement>(
        'nav[aria-label="On this page"] a[href^="#"]',
      ),
    ]
    expect(anchors.length).toBeGreaterThan(0)

    for (const anchor of anchors) {
      const id = anchor.getAttribute("href")?.slice(1) ?? ""
      expect(container.querySelector(`section#${id}`), id).not.toBeNull()
    }
  })

  it("offers the language switcher at the top and the bottom of the page", () => {
    const switchers = container.querySelectorAll(
      '[data-testid="whats-new-language-switcher"]',
    )

    // The page is long and English-only; a non-English reader must not have
    // to scroll to the end to find a way out, nor back to the top.
    expect(switchers).toHaveLength(2)
    for (const switcher of switchers) {
      expect(switcher.textContent).toContain(WHATS_NEW_LANGUAGE_SWITCHER.label)
    }
  })

  it("offers the browse-all-languages index from both switchers", () => {
    const links = [
      ...container.querySelectorAll<HTMLAnchorElement>(
        '[data-testid="whats-new-all-languages-link"]',
      ),
    ]

    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link.getAttribute("href")).toBe("/languages")
    }
  })

  it("passes every supplied language into both switchers", () => {
    const combos = [
      ...container.querySelectorAll('[data-testid="language-combobox-mock"]'),
    ]

    expect(combos).toHaveLength(2)
    for (const combo of combos) {
      expect(combo.getAttribute("data-option-slugs")).toBe(
        LANGUAGES.map((language) => language.slug).join(","),
      )
      expect(combo.getAttribute("data-value")).toBe("english")
    }
  })

  it("no longer ships a hard-coded English-home CTA", () => {
    // The switcher replaced it — an "Explore the new Watch experience" link
    // sent every reader to the English home regardless of their language.
    const homeLinks = [
      ...container.querySelectorAll<HTMLAnchorElement>("a"),
    ].filter((link) => link.getAttribute("href") === "/")

    expect(homeLinks).toEqual([])
  })

  it("opens the shared feedback composer from both feedback CTAs", () => {
    const opens = vi.fn()
    window.addEventListener(WATCH_FEEDBACK_OPEN_EVENT, opens)

    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].filter((button) =>
      button.textContent?.includes(WHATS_NEW_HERO.feedbackCta),
    )
    expect(buttons).toHaveLength(2)

    for (const button of buttons) {
      act(() => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      })
    }

    window.removeEventListener(WATCH_FEEDBACK_OPEN_EVENT, opens)
    expect(opens).toHaveBeenCalledTimes(2)
  })

  describe("the AI-assistant section", () => {
    it("gives every on-this-page entry a section that actually exists", () => {
      // The nav is generated from WHATS_NEW_CONTENTS, so adding a label
      // without its section ships a dead anchor that nothing else catches.
      for (const entry of WHATS_NEW_CONTENTS) {
        expect(container.querySelector(`#${entry.id}`)).not.toBeNull()
      }
    })

    it("renders one card per reason", () => {
      expect(
        container.querySelectorAll(
          '[data-testid="whats-new-assistant-reason"]',
        ),
      ).toHaveLength(WHATS_NEW_ASSISTANTS.reasons.length)
    })

    it("illustrates the reasons with a phone showing the whole exchange", () => {
      const phone = container.querySelector(
        '[data-testid="whats-new-assistant-phone"]',
      )
      const messages = [
        ...container.querySelectorAll<HTMLElement>(
          '[data-testid="whats-new-phone-message"]',
        ),
      ]

      expect(phone).not.toBeNull()
      expect(messages).toHaveLength(WHATS_NEW_ASSISTANTS.phone.messages.length)
      expect(messages.map((node) => node.dataset.from)).toEqual(
        WHATS_NEW_ASSISTANTS.phone.messages.map((message) => message.from),
      )
      // The cited result is the point of the mockup — our content named
      // inside someone else's answer. A mock without it illustrates
      // nothing this section is arguing.
      expect(
        container.querySelector('[data-testid="whats-new-phone-citation"]'),
      ).not.toBeNull()
    })

    it("labels the transcript as abridged and links to the original", () => {
      // LOAD-BEARING, and it is the whole licence for the two decisions
      // above it: reproducing a real exchange, inside a named vendor's
      // chrome. Abridged means the reader is not seeing every word, and
      // the link is what lets them check the words they are seeing.
      // Without both, this stops being evidence and becomes an advert.
      const phone = container.querySelector(
        '[data-testid="whats-new-assistant-phone"]',
      )
      const link = phone?.querySelector<HTMLAnchorElement>(
        `a[href="${WHATS_NEW_ASSISTANTS.phone.sourceHref}"]`,
      )

      expect(textContent()).toContain(WHATS_NEW_ASSISTANTS.phone.disclaimer)
      expect(link).not.toBeNull()
      expect(link?.textContent).toBe(WHATS_NEW_ASSISTANTS.phone.sourceLabel)
      expect(link?.getAttribute("target")).toBe("_blank")
      expect(WHATS_NEW_ASSISTANTS.phone.sourceHref).toMatch(
        /^https:\/\/chatgpt\.com\/share\//,
      )
    })

    it("hands the reader our catalogue inside the assistant's answer", () => {
      // The point of showing this exchange at all. An answer that never
      // names or links jesusfilm.org illustrates nothing the section is
      // arguing.
      const citation = container.querySelector(
        '[data-testid="whats-new-phone-citation"]',
      )

      expect(citation).not.toBeNull()
      expect(citation?.textContent).toContain("jesusfilm.org")
      expect(
        container.querySelectorAll(
          '[data-testid="whats-new-phone-source-chip"]',
        ).length,
      ).toBeGreaterThan(0)
    })

    it("leaves the phone screen itself inert", () => {
      // The device is a drawing: a real input or button inside it would
      // take focus and offer a composer that cannot do anything. Scoped to
      // the screen, NOT the whole figure — the caption's link to the
      // original transcript is deliberately focusable, and asserting over
      // the figure would forbid the very thing the test above requires.
      const device = container.querySelector(
        '[data-testid="whats-new-phone-device"]',
      )

      expect(device).not.toBeNull()
      expect(
        device?.querySelectorAll("input, button, a, textarea, [tabindex]"),
      ).toHaveLength(0)
    })

    it("shows every study's quote alongside our own reading of it", () => {
      const text = textContent()
      for (const source of WHATS_NEW_ASSISTANTS.sources) {
        expect(text).toContain(source.quote)
        expect(text).toContain(source.finding)
        expect(text).toContain(source.quoteNote)
      }
    })

    it("makes every study checkable — one off-site link per source", () => {
      const cards = [
        ...container.querySelectorAll(
          '[data-testid="whats-new-assistant-source"]',
        ),
      ]
      expect(cards).toHaveLength(WHATS_NEW_ASSISTANTS.sources.length)

      for (const [index, card] of cards.entries()) {
        const source = WHATS_NEW_ASSISTANTS.sources[index]
        const link = card.querySelector<HTMLAnchorElement>("a")

        // A statistic a reader cannot check is worth less than no
        // statistic — the citation is the whole point of these cards.
        expect(link?.getAttribute("href")).toBe(source.href)
        expect(link?.getAttribute("target")).toBe("_blank")
        expect(link?.getAttribute("rel")).toContain("noreferrer")
        expect(source.href.startsWith("https://")).toBe(true)
      }
    })

    it("describes the chart for a reader who cannot see it", () => {
      const chart = container.querySelector(
        '[data-testid="whats-new-ai-traffic-chart"] svg',
      )

      expect(chart?.getAttribute("role")).toBe("img")
      expect(chart?.getAttribute("aria-label")).toBe(
        WHATS_NEW_ASSISTANTS.chart.alt,
      )
    })

    it("ends the trend line at its own highest point", () => {
      // LOAD-BEARING. The alt text and the surrounding copy both say the
      // line peaks at the right-hand edge. Re-tracing the screenshot could
      // break that without breaking anything else, leaving the page
      // describing a chart it is not drawing.
      const line = container.querySelector(
        '[data-testid="whats-new-trend-line"]',
      )
      const ys = [
        ...(line?.getAttribute("d") ?? "").matchAll(/[ML][\d.]+ ([\d.]+)/g),
      ].map((match) => Number(match[1]))

      expect(ys.length).toBeGreaterThan(20)
      // SVG y grows downward, so the peak is the minimum.
      expect(Math.min(...ys)).toBe(ys[ys.length - 1])
    })

    it("keeps the chart figure out of being a scroll container", () => {
      // LOAD-BEARING, and the failure is silent. Any `overflow` value
      // other than `visible` makes the figure a scroll container, and the
      // `animation-timeline: view()` reveal on the line inside then
      // resolves against a box that never scrolls: the draw freezes at
      // whatever progress it first computed. No error, no failing render,
      // and a screenshot still shows a plausible fully-drawn chart — so
      // nothing but this assertion catches it.
      const figure = container.querySelector(
        '[data-testid="whats-new-ai-traffic-chart"]',
      )

      expect(figure).not.toBeNull()
      expect(figure?.className ?? "").not.toMatch(/(^|\s|:)overflow-/)
    })

    it("prints no number anywhere in the figure", () => {
      const figure = container.querySelector(
        '[data-testid="whats-new-ai-traffic-chart"]',
      )

      // A bare digit check rather than a "looks like a number" pattern:
      // textContent concatenates the axis labels with no separator
      // (`2024Now`), so anything anchored on a word boundary silently
      // never matches and the assertion passes for the wrong reason.
      // Anti-vacuous — the figure carries plenty of text, so this holds
      // only because none of that text is a value.
      expect((figure?.textContent ?? "").length).toBeGreaterThan(40)
      expect(figure?.textContent ?? "").not.toMatch(/[0-9]/)
    })
  })
})
