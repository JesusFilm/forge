/**
 * @vitest-environment jsdom
 */

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  WATCH_HERO_PRIMARY_ACTION_CLASS,
  WATCH_HERO_TITLE_CLASS,
  WatchHeroOverlay,
} from "@/components/watch/WatchHeroOverlay"
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"

function render(node: React.ReactNode) {
  const container = document.createElement("div")
  container.innerHTML = renderToStaticMarkup(<>{node}</>)
  return container
}

describe("WatchHeroOverlay", () => {
  it("stacks eyebrow, title and actions, and drops empty slots", () => {
    const container = render(
      <WatchHeroOverlay
        testId="overlay"
        label="Feature Film"
        title="JESUS"
        actions={<button type="button">Watch now</button>}
      />,
    )

    const overlay = container.querySelector('[data-testid="overlay"]')
    expect(Array.from(overlay?.children ?? []).map((el) => el.tagName)).toEqual(
      ["SPAN", "H1", "DIV"],
    )
    expect(overlay?.querySelector("span")?.className).toContain(
      WATCH_SECTION_EYEBROW_CLASS.split(" ")[0],
    )
    expect(overlay?.querySelector("h1")?.className).toContain(
      WATCH_HERO_TITLE_CLASS.split(" ")[0],
    )

    const bare = render(<WatchHeroOverlay testId="overlay" title="JESUS" />)
    expect(
      Array.from(
        bare.querySelector('[data-testid="overlay"]')?.children ?? [],
      ).map((el) => el.tagName),
    ).toEqual(["H1", "DIV"])
  })

  it("renders the title as the tag the surface asks for", () => {
    // The watch page's title is the page h1; the home intro's is a p, because
    // its h1 lives outside the carousel.
    const container = render(
      <WatchHeroOverlay titleAs="p" title="JESUS" titleTestId="title" />,
    )
    expect(container.querySelector('[data-testid="title"]')?.tagName).toBe("P")
    expect(container.querySelectorAll("h1")).toHaveLength(0)
  })

  it("threads per-slot classes and styles for the carousel's stagger", () => {
    const container = render(
      <WatchHeroOverlay
        label="Segment"
        labelTestId="label"
        labelSlot={{ className: "enter", style: { opacity: 0.5 } }}
        title="JESUS"
        titleTestId="title"
        titleSlot={{ className: "enter-title" }}
        actions={
          <button type="button" data-testid="overlay-action">
            Watch Now
          </button>
        }
        actionsSlot={{ className: "enter-actions" }}
      />,
    )

    const label = container.querySelector('[data-testid="label"]')
    expect(label?.className).toContain("enter")
    expect(label?.getAttribute("style")).toContain("opacity")
    expect(
      container.querySelector('[data-testid="title"]')?.className,
    ).toContain("enter-title")
    expect(
      container.querySelector('[data-testid="overlay-action"]')?.parentElement
        ?.className,
    ).toContain("enter-actions")
  })

  it("hides the outgoing copy from assistive tech when asked", () => {
    const container = render(
      <WatchHeroOverlay testId="overlay" ariaHidden title="JESUS" />,
    )
    expect(
      container
        .querySelector('[data-testid="overlay"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true")
  })

  it("exports one primary action treatment for both surfaces", () => {
    expect(WATCH_HERO_PRIMARY_ACTION_CLASS).toContain("bg-brand-red")
    expect(WATCH_HERO_PRIMARY_ACTION_CLASS).toContain("rounded-full")
  })
})
