// @vitest-environment jsdom

import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it } from "vitest"
import {
  WATCH_HOME_CATEGORY_CATALOG,
  type WatchHomeCategoryId,
} from "@forge/watch-url-policy/watch-home-categories"
import { WatchHomeCategoryRailEditor } from "./watch-home-category-rail-editor"

function StatefulEditor({ initialIds }: { initialIds: WatchHomeCategoryId[] }) {
  const [categoryIds, setCategoryIds] = useState(initialIds)
  return (
    <WatchHomeCategoryRailEditor
      categoryIds={categoryIds}
      onChange={setCategoryIds}
    />
  )
}

function renderEditorDom(initialIds: WatchHomeCategoryId[]) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() => root.render(<StatefulEditor initialIds={initialIds} />))

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

function selectedLabels(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[data-selected-category]"))
    .map((element) => element.getAttribute("data-selected-category"))
    .filter((value): value is string => value !== null)
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
        categoryIds={["jesus", "family"]}
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
    const view = renderEditorDom(["jesus", "gospels", "family"])

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

      expect(selectedLabels(view.container)).toEqual([
        "jesus",
        "family",
        "gospels",
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

  it("removes and appends a tile once", () => {
    const view = renderEditorDom(["jesus", "gospels"])

    try {
      act(() => button(view.container, "Remove Gospels").click())
      expect(selectedLabels(view.container)).toEqual(["jesus"])

      act(() => button(view.container, "Add Gospels").click())
      expect(selectedLabels(view.container)).toEqual(["jesus", "gospels"])
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
        categoryIds={[WATCH_HOME_CATEGORY_CATALOG[0].id]}
        onChange={() => undefined}
      />,
    )

    expect(html).toContain('aria-label="Remove The JESUS Film"')
    expect(html).toContain('disabled=""')
    expect(html).toContain(
      "At least one tile is required. Remove the entire block to hide this section.",
    )
  })
})
