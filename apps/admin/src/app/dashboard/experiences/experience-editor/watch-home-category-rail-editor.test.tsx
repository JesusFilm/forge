// @vitest-environment jsdom

import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it } from "vitest"
import { WATCH_HOME_CATEGORY_CATALOG } from "@forge/watch-url-policy/watch-home-categories"
import { WatchHomeCategoryRailEditor } from "./watch-home-category-rail-editor"
import { categoryTileId, type RailTile } from "./watch-home-category-rail-tiles"

function categoryTiles(categoryIds: string[]): RailTile[] {
  return categoryIds.map((categoryId) => ({
    id: categoryTileId(categoryId),
    categoryId,
  }))
}

function StatefulEditor({ initialTiles }: { initialTiles: RailTile[] }) {
  const [tiles, setTiles] = useState(initialTiles)
  return <WatchHomeCategoryRailEditor tiles={tiles} onChange={setTiles} />
}

function renderEditorDom(initialTiles: RailTile[]) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() => root.render(<StatefulEditor initialTiles={initialTiles} />))

  return {
    container,
    cleanup() {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function button(container: HTMLElement, label: string) {
  const element = container.querySelector(`button[aria-label="${label}"]`)
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }
  return element
}

function field(container: HTMLElement, label: string) {
  const element = container.querySelector(`[aria-label="${label}"]`)
  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLSelectElement)
  ) {
    throw new Error(`Field not found: ${label}`)
  }
  return element
}

/** Emulates a user edit — React needs the native setter to see the change. */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set
  setter?.call(select, value)
  select.dispatchEvent(new Event("change", { bubbles: true }))
}

function tileIds(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[data-rail-tile]"))
    .map((element) => element.getAttribute("data-rail-tile"))
    .filter((value): value is string => value !== null)
}

function swatchGradient(container: HTMLElement, tileId: string) {
  const element = container.querySelector(`[data-rail-tile-swatch="${tileId}"]`)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Swatch not found: ${tileId}`)
  }
  return element.style.backgroundImage
}

describe("WatchHomeCategoryRailEditor", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    window.requestAnimationFrame ??= ((callback: FrameRequestCallback) =>
      window.setTimeout(
        () => callback(performance.now()),
        0,
      )) as typeof window.requestAnimationFrame
  })

  it("shows staff labels and destination slugs for selected and available categories", () => {
    const html = renderToStaticMarkup(
      <WatchHomeCategoryRailEditor
        tiles={categoryTiles(["jesus", "family"])}
        onChange={() => undefined}
      />,
    )

    expect(html).toContain("The JESUS Film")
    expect(html).toContain("/watch/jesus.html")
    expect(html).toContain("Family")
    expect(html).toContain("/watch/family.html")
    expect(html).toContain("Gospels")
    expect(html).toContain("/watch/lumo.html")
  })

  it("moves tiles in exact order, retains focus, announces position, and disables boundaries", async () => {
    const view = renderEditorDom(categoryTiles(["jesus", "gospels", "family"]))

    try {
      expect(button(view.container, "Move The JESUS Film up").disabled).toBe(
        true,
      )
      expect(button(view.container, "Move Family down").disabled).toBe(true)

      const moveFamilyUp = button(view.container, "Move Family up")
      moveFamilyUp.focus()
      await act(async () => {
        moveFamilyUp.click()
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      })

      expect(tileIds(view.container)).toEqual([
        "category:jesus",
        "category:family",
        "category:gospels",
      ])
      expect(document.activeElement).toBe(
        button(view.container, "Move Family up"),
      )
      expect(view.container.querySelector('[role="status"]')?.textContent).toBe(
        "Family moved to position 2 of 3.",
      )
    } finally {
      view.cleanup()
    }
  })

  it("removes and appends a category tile once", () => {
    const view = renderEditorDom(categoryTiles(["jesus", "gospels"]))

    try {
      act(() => button(view.container, "Remove Gospels").click())
      expect(tileIds(view.container)).toEqual(["category:jesus"])

      act(() => button(view.container, "Add Gospels").click())
      expect(tileIds(view.container)).toEqual([
        "category:jesus",
        "category:gospels",
      ])
      expect(
        view.container.querySelectorAll('[aria-label="Add Gospels"]'),
      ).toHaveLength(0)
    } finally {
      view.cleanup()
    }
  })

  it("disables final removal and explains how to hide the section", () => {
    const html = renderToStaticMarkup(
      <WatchHomeCategoryRailEditor
        tiles={categoryTiles([WATCH_HOME_CATEGORY_CATALOG[0].id])}
        onChange={() => undefined}
      />,
    )

    expect(html).toContain('aria-label="Remove The JESUS Film"')
    expect(html).toContain('disabled=""')
    expect(html).toContain(
      "At least one tile is required. Remove the entire block to hide this section.",
    )
  })

  it("adds a custom tile seeded valid so it cannot fail the schema before it is edited", () => {
    const view = renderEditorDom(categoryTiles(["jesus"]))

    try {
      const addCustom = Array.from(
        view.container.querySelectorAll("button"),
      ).find((element) => element.textContent?.includes("Custom tile"))
      if (!addCustom) throw new Error("Add custom tile button not found")
      act(() => addCustom.click())

      expect(tileIds(view.container)).toEqual(["category:jesus", "custom-1"])
      expect(field(view.container, "New tile title")).toHaveProperty(
        "value",
        "New tile",
      )
      expect(field(view.container, "New tile destination")).toHaveProperty(
        "value",
        "/watch",
      )
      // Nothing is flagged — a freshly added tile is already persistable.
      expect(view.container.querySelectorAll('[role="alert"]')).toHaveLength(0)
    } finally {
      view.cleanup()
    }
  })

  it("overrides a predefined tile's title, destination, icon, and style", () => {
    const view = renderEditorDom(categoryTiles(["jesus"]))

    try {
      const defaultGradient = swatchGradient(view.container, "category:jesus")

      act(() =>
        typeInto(
          field(view.container, "The JESUS Film title") as HTMLInputElement,
          "Meet Jesus",
        ),
      )
      act(() =>
        typeInto(
          field(view.container, "Meet Jesus destination") as HTMLInputElement,
          "https://example.org/jesus",
        ),
      )
      act(() =>
        choose(
          field(view.container, "Meet Jesus icon") as HTMLSelectElement,
          "star",
        ),
      )
      act(() =>
        choose(
          field(view.container, "Meet Jesus style") as HTMLSelectElement,
          "forest",
        ),
      )

      expect(view.container.textContent).toContain("Meet Jesus")
      expect(view.container.textContent).toContain("https://example.org/jesus")
      expect(swatchGradient(view.container, "category:jesus")).not.toBe(
        defaultGradient,
      )
      expect(view.container.querySelectorAll('[role="alert"]')).toHaveLength(0)
    } finally {
      view.cleanup()
    }
  })

  it("lets a trailing space survive so a multi-word title can be typed at all", () => {
    // Trimming inside the change handler makes the controlled input rewrite
    // "Meet " back to "Meet" on every keystroke, so the space between the two
    // words can never be entered. Canonical trimming belongs at serialization.
    const view = renderEditorDom(categoryTiles(["jesus"]))

    try {
      act(() =>
        typeInto(
          field(view.container, "The JESUS Film title") as HTMLInputElement,
          "Meet ",
        ),
      )
      expect(field(view.container, "Meet title")).toHaveProperty(
        "value",
        "Meet ",
      )

      act(() =>
        typeInto(
          field(view.container, "Meet title") as HTMLInputElement,
          "Meet Jesus",
        ),
      )
      expect(field(view.container, "Meet Jesus title")).toHaveProperty(
        "value",
        "Meet Jesus",
      )
    } finally {
      view.cleanup()
    }
  })

  it("treats a whitespace-only field as cleared, not as authored copy", () => {
    const view = renderEditorDom(categoryTiles(["jesus"]))

    try {
      act(() =>
        typeInto(
          field(view.container, "The JESUS Film title") as HTMLInputElement,
          "   ",
        ),
      )
      expect(view.container.textContent).toContain("The JESUS Film")
      expect(view.container.querySelectorAll('[role="alert"]')).toHaveLength(0)
    } finally {
      view.cleanup()
    }
  })

  it("clearing an override restores the category default rather than persisting an empty string", () => {
    const view = renderEditorDom([
      { id: categoryTileId("jesus"), categoryId: "jesus", title: "Meet Jesus" },
    ])

    try {
      act(() =>
        typeInto(
          field(view.container, "Meet Jesus title") as HTMLInputElement,
          "",
        ),
      )

      // Back to the catalog staff label, and no validation complaint — a
      // predefined tile with no title is valid, unlike a custom one.
      expect(view.container.textContent).toContain("The JESUS Film")
      expect(view.container.querySelectorAll('[role="alert"]')).toHaveLength(0)
    } finally {
      view.cleanup()
    }
  })

  it("flags an unsafe destination inline instead of waiting for save", () => {
    const view = renderEditorDom([
      { id: "custom-1", title: "Partner", href: "/partners" },
    ])

    try {
      expect(view.container.querySelectorAll('[role="alert"]')).toHaveLength(0)

      act(() =>
        typeInto(
          field(view.container, "Partner destination") as HTMLInputElement,
          "javascript:alert(1)",
        ),
      )

      const alert = view.container.querySelector('[role="alert"]')
      expect(alert?.textContent).toContain(
        "Destination must be a site path starting with / or an https:// URL",
      )
      expect(
        field(view.container, "Partner destination").getAttribute(
          "aria-invalid",
        ),
      ).toBe("true")
    } finally {
      view.cleanup()
    }
  })

  it("flags a custom tile that loses its title, which a predefined tile may omit", () => {
    const view = renderEditorDom([
      { id: "custom-1", title: "Partner", href: "/partners" },
    ])

    try {
      act(() =>
        typeInto(
          field(view.container, "Partner title") as HTMLInputElement,
          "",
        ),
      )

      expect(
        view.container.querySelector('[role="alert"]')?.textContent,
      ).toContain("A custom tile needs a title")
    } finally {
      view.cleanup()
    }
  })
})
