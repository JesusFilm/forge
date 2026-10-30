// @vitest-environment jsdom
import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"
import { createWatchAudienceConfiguration } from "@forge/experience-schema"
import { WatchAudienceEditor } from "./watch-audience-editor"
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
function setup() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  let changes = 0
  let current = createWatchAudienceConfiguration()
  function Harness() {
    const [value, setValue] = useState(current)
    return (
      <WatchAudienceEditor
        configuration={value}
        onChange={(next) => {
          changes++
          current = next
          setValue(next)
        }}
      />
    )
  }
  const root = createRoot(container)
  act(() => root.render(<Harness />))
  return {
    container,
    get changeCount() {
      return changes
    },
    get value() {
      return current
    },
    cleanup() {
      act(() => root.unmount())
      container.remove()
    },
  }
}
function click(container: HTMLElement, label: string) {
  const b = Array.from(container.querySelectorAll("button")).find(
    (e) => e.getAttribute("aria-label") === label || e.textContent === label,
  )
  if (!b) throw new Error(label)
  act(() => b.click())
}
function input(container: HTMLElement, label: string, value: string) {
  const e = container.querySelector(`[aria-label="${label}"]`)
  if (!(e instanceof HTMLInputElement)) throw new Error(label)
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(e, value)
    e.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
describe("Watch audience editor", () => {
  it("automatically activates roving tabs without modifying the authored configuration", () => {
    const f = setup()
    try {
      const before = structuredClone(f.value)
      const tabs = [
        ...f.container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
      ]
      const press = (key: string) =>
        act(() =>
          document.activeElement!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              bubbles: true,
              cancelable: true,
            }),
          ),
        )
      tabs[0]!.focus()
      expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1])
      for (const [key, index] of [
        ["ArrowRight", 1],
        ["End", 3],
        ["ArrowRight", 0],
        ["ArrowLeft", 3],
        ["Home", 0],
      ] as const) {
        press(key)
        expect(document.activeElement).toBe(tabs[index])
        expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(
          tabs.map((_, i) => String(i === index)),
        )
        const panel = document.getElementById(
          tabs[index]!.getAttribute("aria-controls")!,
        )!
        expect(panel.getAttribute("role")).toBe("tabpanel")
        expect(panel.getAttribute("aria-labelledby")).toBe(tabs[index]!.id)
        expect(panel.querySelector("legend")?.textContent).toBe(
          `${tabs[index]!.textContent} copy`,
        )
      }
      expect(f.value).toEqual(before)
      expect(f.changeCount).toBe(0)
      input(f.container, "explore heading", "Retained authored heading")
      press("ArrowRight")
      press("Home")
      expect(
        f.container.querySelector<HTMLInputElement>(
          '[aria-label="explore heading"]',
        )?.value,
      ).toBe("Retained authored heading")
    } finally {
      f.cleanup()
    }
  })

  it("edits all role copy without changing other roles", () => {
    const f = setup()
    try {
      for (const role of ["explore", "grow", "share", "partner"]) {
        click(f.container, role)
        input(f.container, `${role} heading`, `${role} authored heading`)
      }
      expect(f.value.roles.map((r) => r.heading)).toEqual([
        "explore authored heading",
        "grow authored heading",
        "share authored heading",
        "partner authored heading",
      ])
      expect(f.container.textContent).not.toContain("Add question")
    } finally {
      f.cleanup()
    }
  })
  it("keeps score references valid while renaming, reordering and deleting actions", () => {
    const f = setup()
    try {
      input(f.container, "Action 1 ID", "authored-action")
      expect(
        f.value.roles[0]!.questions[0]!.options[0]!.scores[0]!.actionId,
      ).toBe("authored-action")
      input(f.container, "Question 1 option 1 score authored-action", "9")
      click(f.container, "Move action 1 down")
      expect(f.value.roles[0]!.actions[1]!.id).toBe("authored-action")
      click(f.container, "Remove action 2")
      expect(f.value.roles[0]!.questions[0]!.options[0]!.scores).toEqual([])
    } finally {
      f.cleanup()
    }
  })
  it("preserves each action's scores when typing through a colliding ID prefix", () => {
    const f = setup()
    try {
      input(f.container, "Action 1 ID", "share-kit")
      input(f.container, "Action 2 ID", "share")
      input(f.container, "Question 1 option 1 score share-kit", "7")
      input(f.container, "Question 1 option 2 score share", "9")
      const before = structuredClone(f.value)
      for (const value of ["share-ki", "share-k", "share-", "share"])
        input(f.container, "Action 1 ID", value)
      expect(
        f.container.querySelector('[aria-label="Audience validation errors"]')
          ?.textContent,
      ).toContain("Duplicate ID: share")
      for (const value of [
        "share-",
        "share-f",
        "share-fi",
        "share-fil",
        "share-film",
      ])
        input(f.container, "Action 1 ID", value)
      expect(f.value.roles[0]!.questions).toEqual(
        before.roles[0]!.questions.map((question) => ({
          ...question,
          options: question.options.map((option) => ({
            ...option,
            scores: option.scores.map((score) => ({
              ...score,
              actionId:
                score.actionId === "share-kit" ? "share-film" : score.actionId,
            })),
          })),
        })),
      )
      expect(f.value.roles.slice(1)).toEqual(before.roles.slice(1))
      expect(
        f.container.querySelector('[aria-label="Audience validation errors"]'),
      ).toBeNull()
    } finally {
      f.cleanup()
    }
  })
  it("shows field-local errors and retains invalid edits", () => {
    const f = setup()
    try {
      input(f.container, "Question 2 ID", f.value.roles[0]!.questions[0]!.id)
      expect(
        f.container.querySelector('[aria-label="Audience validation errors"]')
          ?.textContent,
      ).toContain("roles.0.questions.1.id")
      expect(f.value.roles[0]!.questions[1]!.id).toBe(
        f.value.roles[0]!.questions[0]!.id,
      )
    } finally {
      f.cleanup()
    }
  })
  it("keeps score ownership through edits, role changes, moves and removal during an ID collision", () => {
    const f = setup()
    try {
      input(f.container, "Action 1 ID", "share-kit")
      input(f.container, "Action 2 ID", "share")
      input(f.container, "Action 1 ID", "share")
      input(f.container, "Question 1 option 1 score share", "7")
      click(f.container, "grow")
      input(f.container, "grow heading", "Authored grow heading")
      click(f.container, "explore")
      click(f.container, "Move action 1 down")
      click(f.container, "Remove action 1")
      input(f.container, "Action 1 ID", "share-film")
      expect(f.value.roles[0]!.questions[0]!.options[0]!.scores).toEqual([
        { actionId: "share-film", weight: 7 },
      ])
      expect(f.value.roles[0]!.questions[0]!.options[1]!.scores).toEqual([])
      expect(
        f.container.querySelector('[aria-label="Audience validation errors"]'),
      ).toBeNull()
    } finally {
      f.cleanup()
    }
  })
  it("preserves both score mappings when the other action resolves the ID collision", () => {
    const f = setup()
    try {
      input(f.container, "Action 1 ID", "share-kit")
      input(f.container, "Action 2 ID", "share")
      input(f.container, "Action 1 ID", "share")
      input(f.container, "Action 2 ID", "share-history")
      input(f.container, "Action 1 ID", "share-film")
      expect(
        f.value.roles[0]!.questions[0]!.options.map((o) => o.scores),
      ).toEqual([
        [{ actionId: "share-film", weight: 2 }],
        [{ actionId: "share-history", weight: 2 }],
      ])
      expect(
        f.container.querySelector('[aria-label="Audience validation errors"]'),
      ).toBeNull()
    } finally {
      f.cleanup()
    }
  })
  it("keeps scores with their actions when IDs are swapped through a collision", () => {
    const f = setup()
    try {
      input(f.container, "Action 1 ID", "view-history")
      input(f.container, "Action 2 ID", "browse-languages")
      expect(
        f.value.roles[0]!.questions[0]!.options.map((o) => o.scores),
      ).toEqual([
        [{ actionId: "view-history", weight: 2 }],
        [{ actionId: "browse-languages", weight: 2 }],
      ])
      expect(
        f.container.querySelector('[aria-label="Audience validation errors"]'),
      ).toBeNull()
    } finally {
      f.cleanup()
    }
  })
  it("bounds option/action addition and refuses a fourth question", () => {
    const f = setup()
    try {
      for (let i = 0; i < 8; i++) click(f.container, "Add question 1 option")
      expect(f.value.roles[0]!.questions[0]!.options).toHaveLength(6)
      for (let i = 0; i < 10; i++) click(f.container, "Add action")
      expect(f.value.roles[0]!.actions).toHaveLength(8)
      expect(f.value.roles[0]!.questions).toHaveLength(3)
    } finally {
      f.cleanup()
    }
  })
  it("previews authored score ordering and reason copy without navigating", () => {
    const f = setup()
    try {
      input(f.container, "Question 1 option 1 reason", "authored reason")
      input(f.container, "Question 1 option 1 score view-history", "10")
      const radios = Array.from(
        f.container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
      )
      for (const i of [0, 2, 4]) act(() => radios[i]!.click())
      const status = f.container.querySelector('[role="status"]')
      expect(status?.textContent).toContain("authored reason")
      expect(status?.querySelector("li")?.textContent).toContain(
        "Continue watching",
      )
    } finally {
      f.cleanup()
    }
  })
})
