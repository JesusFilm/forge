// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { InventoryFilterShell } from "./InventoryFilterShell"

// The shell hides SERVER-rendered nodes by setting the `hidden` property, which
// is what these tests assert. Turning that property into `display: none` is
// Tailwind preflight's `[hidden]:where(:not([hidden="until-found"]))` rule with
// `!important` — that `!important` is load-bearing, because the episode rows
// carry `flex`, which would otherwise win. jsdom ships no preflight, so the
// paint half is verified in a browser (2026-08-27: 277 hidden rows inside
// visible groups all measured `display: none`, height 0).

type ItemSpec = {
  id: string
  length?: string
  type?: string
  recent?: "yes" | "no"
  ageDays?: string
}

function Item({
  id,
  length = "under5",
  type = "episode",
  recent = "no",
  // Old enough to fall outside every offered window unless a test says otherwise.
  ageDays = "400",
}: ItemSpec) {
  return (
    <a
      data-testid={id}
      data-inv-item=""
      data-inv-length={length}
      data-inv-type={type}
      data-inv-availability="AUDIO"
      data-inv-recent={recent}
      data-inv-age-days={ageDays}
    >
      {id}
    </a>
  )
}

describe("InventoryFilterShell", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function renderShell(children: React.ReactNode) {
    act(() => {
      root.render(<InventoryFilterShell>{children}</InventoryFilterShell>)
    })
  }

  const click = (testId: string) => {
    act(() => {
      container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.click()
    })
  }

  /// The options sit behind a disclosure that starts CLOSED. jsdom fires
  /// `.click()` on `display: none` nodes happily, so without expanding first
  /// every option test below would pass against a surface a real user cannot
  /// reach — the exact failure mode the collapsed default introduces.
  const expand = () => click("language-inventory-filters-toggle")

  const isHidden = (testId: string) =>
    container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.hidden

  const readout = () =>
    container
      .querySelector('[data-testid="language-inventory-filters-count"]')
      ?.textContent?.trim() ?? null

  it("starts collapsed, with the options behind the disclosure", () => {
    renderShell(<Item id="a" />)

    const toggle = container.querySelector<HTMLElement>(
      '[data-testid="language-inventory-filters-toggle"]',
    )
    const options = container.querySelector<HTMLElement>(
      "#language-inventory-filters-options",
    )

    expect(toggle?.getAttribute("aria-expanded")).toBe("false")
    expect(options?.hidden).toBe(true)
    expect(toggle?.getAttribute("aria-controls")).toBe(
      "language-inventory-filters-options",
    )
  })

  it("opens and closes the options on the disclosure", () => {
    renderShell(<Item id="a" />)

    expand()
    expect(
      container.querySelector<HTMLElement>(
        "#language-inventory-filters-options",
      )?.hidden,
    ).toBe(false)
    expect(
      container
        .querySelector('[data-testid="language-inventory-filters-toggle"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true")

    click("language-inventory-filters-toggle")
    expect(
      container.querySelector<HTMLElement>(
        "#language-inventory-filters-options",
      )?.hidden,
    ).toBe(true)
  })

  it("keeps an applied filter in force after the options are collapsed again", () => {
    renderShell(
      <>
        <Item id="short" length="under5" />
        <Item id="long" length="over30" />
      </>,
    )

    expand()
    click("language-inventory-filter-length-under5")
    expect(isHidden("long")).toBe(true)

    // Collapsing is a disclosure, not a reset — the readout and Clear button
    // live outside the collapsed region precisely so an active filter stays
    // discoverable.
    click("language-inventory-filters-toggle")
    expect(isHidden("long")).toBe(true)
    expect(readout()).toBe("1 of 2 shown")
    expect(
      container.querySelector(
        '[data-testid="language-inventory-filters-clear"]',
      ),
    ).not.toBeNull()
  })

  it("does not offer a collection type option", () => {
    renderShell(<Item id="a" type="episode" />)
    expand()

    // Series/collections render as a group's sidebar PANEL, never as an item,
    // so the option could only ever return 0 results.
    expect(
      container.querySelector(
        '[data-testid="language-inventory-filter-type-collection"]',
      ),
    ).toBeNull()
    expect(
      container.querySelectorAll(
        '[data-testid^="language-inventory-filter-type-"]',
      ),
    ).toHaveLength(3)
  })

  it("offers feature films and short films as separate options", () => {
    renderShell(
      <>
        <Item id="feature" type="featureFilm" />
        <Item id="short" type="shortFilm" />
      </>,
    )

    expand()
    click("language-inventory-filter-type-featureFilm")

    // The whole point of the split: choosing feature films must not sweep in
    // the 171 short films that used to share the bucket.
    expect(isHidden("feature")).toBe(false)
    expect(isHidden("short")).toBe(true)

    click("language-inventory-filter-type-featureFilm")
    click("language-inventory-filter-type-shortFilm")
    expect(isHidden("feature")).toBe(true)
    expect(isHidden("short")).toBe(false)
  })

  it("hides nothing and shows no readout until a filter is chosen", () => {
    renderShell(
      <>
        <Item id="a" length="under5" />
        <Item id="b" length="over30" />
      </>,
    )

    expect(isHidden("a")).toBe(false)
    expect(isHidden("b")).toBe(false)
    expect(readout()).toBeNull()
    expect(
      container.querySelector(
        '[data-testid="language-inventory-filters-clear"]',
      ),
    ).toBeNull()
  })

  it("hides items outside the chosen length bucket", () => {
    renderShell(
      <>
        <Item id="short" length="under5" />
        <Item id="long" length="over30" />
      </>,
    )

    expand()
    click("language-inventory-filter-length-under5")

    expect(isHidden("short")).toBe(false)
    expect(isHidden("long")).toBe(true)
    expect(readout()).toBe("1 of 2 shown")
  })

  it("ANDs the filter dimensions together", () => {
    renderShell(
      <>
        <Item id="shortFilm" length="under5" type="shortFilm" />
        <Item id="shortEpisode" length="under5" type="episode" />
        <Item id="longFilm" length="over30" type="shortFilm" />
      </>,
    )

    expand()
    click("language-inventory-filter-length-under5")
    click("language-inventory-filter-type-shortFilm")

    expect(isHidden("shortFilm")).toBe(false)
    expect(isHidden("shortEpisode")).toBe(true)
    expect(isHidden("longFilm")).toBe(true)
    expect(readout()).toBe("1 of 3 shown")
  })

  it("filters by cumulative date windows", () => {
    renderShell(
      <>
        <Item id="d10" ageDays="10" />
        <Item id="d120" ageDays="120" />
        <Item id="d300" ageDays="300" />
        <Item id="d800" ageDays="800" />
      </>,
    )
    expand()

    const shown = () =>
      ["d10", "d120", "d300", "d800"].map((id) => !isHidden(id))

    click("language-inventory-filter-added-60d")
    expect(shown()).toEqual([true, false, false, false])

    // Windows NEST: 6 months must still include the 10-day item.
    click("language-inventory-filter-added-60d")
    click("language-inventory-filter-added-6m")
    expect(shown()).toEqual([true, true, false, false])

    click("language-inventory-filter-added-6m")
    click("language-inventory-filter-added-12m")
    expect(shown()).toEqual([true, true, true, false])
  })

  it("offers no window wider than 12 months", () => {
    renderShell(<Item id="a" />)
    expand()

    // A "last 2 years" option would match 1,001 of 1,001 English items, because
    // 89% of the library shares one platform-publish month (2025-06), so it
    // would filter nothing at all.
    expect(
      container.querySelectorAll(
        '[data-testid^="language-inventory-filter-added-"]',
      ),
    ).toHaveLength(3)
    expect(
      container.querySelector(
        '[data-testid="language-inventory-filter-added-2y"]',
      ),
    ).toBeNull()
  })

  it("excludes an undated item from every window", () => {
    renderShell(
      <>
        <Item id="dated" ageDays="10" />
        <Item id="undated" ageDays="unknown" />
      </>,
    )
    expand()

    // `unknown` parses to NaN — it must drop out rather than slip into the
    // newest window through a falsy comparison.
    click("language-inventory-filter-added-12m")
    expect(isHidden("dated")).toBe(false)
    expect(isHidden("undated")).toBe(true)
  })

  it("collapses a group and a section once every item inside is hidden", () => {
    renderShell(
      <section data-inv-section="" data-testid="section">
        <div data-inv-group="" data-testid="keeps">
          <Item id="kept" length="under5" />
        </div>
        <div data-inv-group="" data-testid="empties">
          <Item id="dropped" length="over30" />
        </div>
      </section>,
    )

    expand()
    click("language-inventory-filter-length-under5")

    expect(isHidden("keeps")).toBe(false)
    expect(isHidden("empties")).toBe(true)
    // The section still holds a visible item, so it stays.
    expect(isHidden("section")).toBe(false)

    click("language-inventory-filter-length-over30")
    // Now only the second group matches, so the first collapses instead.
    expect(isHidden("keeps")).toBe(true)
    expect(isHidden("empties")).toBe(false)
    expect(isHidden("section")).toBe(false)
  })

  it("collapses the section and shows one message when nothing matches", () => {
    renderShell(
      <section data-inv-section="" data-testid="section">
        <div data-inv-group="" data-testid="group">
          <Item id="only" length="under5" type="episode" />
        </div>
      </section>,
    )

    expand()
    // `collection` is no longer an offered option, so the zero-result route is
    // asking for a feature film in a group that holds only episodes.
    click("language-inventory-filter-type-featureFilm")

    expect(isHidden("only")).toBe(true)
    expect(isHidden("group")).toBe(true)
    expect(isHidden("section")).toBe(true)
    expect(
      container.querySelector(
        '[data-testid="language-inventory-filters-empty"]',
      ),
    ).not.toBeNull()
    expect(readout()).toBe("0 of 1 shown")
  })

  it("restores everything when cleared", () => {
    renderShell(
      <section data-inv-section="" data-testid="section">
        <div data-inv-group="" data-testid="group">
          <Item id="a" length="under5" />
          <Item id="b" length="over30" />
        </div>
      </section>,
    )

    expand()
    click("language-inventory-filter-length-under5")
    expect(isHidden("b")).toBe(true)

    click("language-inventory-filters-clear")

    expect(isHidden("a")).toBe(false)
    expect(isHidden("b")).toBe(false)
    expect(isHidden("group")).toBe(false)
    expect(isHidden("section")).toBe(false)
    expect(readout()).toBeNull()
  })

  it("toggles a chosen option back off when clicked again", () => {
    renderShell(
      <>
        <Item id="a" length="under5" />
        <Item id="b" length="over30" />
      </>,
    )

    expand()
    click("language-inventory-filter-length-under5")
    expect(isHidden("b")).toBe(true)
    click("language-inventory-filter-length-under5")
    expect(isHidden("b")).toBe(false)
    expect(readout()).toBeNull()
  })

  it("leaves a container with no items of its own alone", () => {
    // The collection sidebar holds no `[data-inv-item]`, so it must never be
    // collapsed by the every()-over-empty-list vacuous truth.
    renderShell(
      <div data-inv-group="" data-testid="sidebarOnly">
        <p>no items here</p>
      </div>,
    )

    expand()
    click("language-inventory-filter-length-under5")

    expect(isHidden("sidebarOnly")).toBe(false)
  })
})
