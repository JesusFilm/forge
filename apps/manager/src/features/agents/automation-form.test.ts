// @vitest-environment jsdom

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AutomationForm } from "./automation-form"

describe("AutomationForm launch confirmation", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function clickButton(text: string) {
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes(text),
    )
    expect(button, `button containing ${text}`).toBeDefined()
    await act(async () => button!.click())
  }

  it("moves focus to each new step heading without stealing initial or editing focus", async () => {
    const onCreate = vi.fn()
    container.tabIndex = -1
    container.focus()
    await act(async () => {
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(AutomationForm, {
            languageOptions: [],
            onCreate,
          }),
        ),
      )
    })
    expect(document.activeElement).toBe(container)

    await clickButton("Transcribe missing subtitles")
    expect(document.activeElement?.id).toBe("agents-config-title")
    const nameInput = container.querySelector("input")!
    nameInput.focus()
    await clickButton("Dry run")
    expect(document.activeElement).toBe(nameInput)

    container
      .querySelector<HTMLButtonElement>(".agents-primary-advance")!
      .focus()
    await clickButton("Review launch")
    expect(document.activeElement?.id).toBe("agents-review-title")
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1")
    expect(onCreate).not.toHaveBeenCalled()

    await clickButton("Back")
    expect(document.activeElement?.id).toBe("agents-config-title")
    await clickButton("Change")
    expect(document.activeElement?.id).toBe("agents-recipe-title")
    await clickButton("Continue to rules")
    expect(document.activeElement?.id).toBe("agents-config-title")
    await clickButton("Review launch")
    expect(document.activeElement?.id).toBe("agents-review-title")
    expect(onCreate).not.toHaveBeenCalled()
  })

  it("requires final confirmation after review and suppresses duplicate pending submits", async () => {
    let finishCreate!: () => void
    const onCreate = vi.fn(
      () => new Promise<void>((resolve) => (finishCreate = resolve)),
    )
    const onCreated = vi.fn()
    await act(async () => {
      root.render(
        React.createElement(AutomationForm, {
          languageOptions: [],
          onCreate,
          onCreated,
        }),
      )
    })

    await clickButton("Transcribe missing subtitles")
    // An implicit form submission from rules must not create an automation.
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    expect(onCreate).not.toHaveBeenCalled()

    await clickButton("Review launch")
    expect(container.querySelector(".agents-review-panel")).not.toBeNull()
    expect(onCreate).not.toHaveBeenCalled()

    await clickButton("Create automation")
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ template: "source_subtitles_missing" }),
    )
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreated).not.toHaveBeenCalled()

    await act(async () => finishCreate())
    expect(onCreated).toHaveBeenCalledOnce()
  })
})
