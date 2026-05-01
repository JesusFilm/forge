/**
 * @vitest-environment jsdom
 *
 * U10 — AskYoursPanel tests.
 *
 * Covers:
 *  - AE6 external links: both "Chat with a person" and "Ask a Bible question"
 *    render as `<a>` (NOT buttons), with `target="_blank"` and
 *    `rel="noreferrer"`. Hrefs include the canonical placeholder URLs +
 *    `utm_source=forge-watch`.
 *  - The Bible-question URL is a known placeholder — the test pins the value
 *    so a future change is intentional and PR-reviewed.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AskYoursPanel } from "@/components/watch/AskYoursPanel"

let container: HTMLDivElement
let root: Root

function $(selector: string): HTMLElement | null {
  return document.querySelector(selector) as HTMLElement | null
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ""
})

describe("AskYoursPanel — AE6 external links", () => {
  it('renders the Chat link as <a target="_blank" rel="noreferrer">', () => {
    act(() => {
      root.render(<AskYoursPanel open onClose={vi.fn()} />)
    })

    const chat = $(
      '[data-testid="watch-ask-yours-chat-link"]',
    ) as HTMLAnchorElement
    expect(chat).not.toBeNull()
    expect(chat.tagName).toBe("A")
    expect(chat.getAttribute("href")).toBe(
      "https://issuesiface.com/talk?utm_source=forge-watch",
    )
    expect(chat.getAttribute("target")).toBe("_blank")
    expect(chat.getAttribute("rel")).toBe("noreferrer")
  })

  it("renders the Bible-question link with placeholder URL + correct attributes", () => {
    act(() => {
      root.render(<AskYoursPanel open onClose={vi.fn()} />)
    })

    const bible = $(
      '[data-testid="watch-ask-yours-bible-link"]',
    ) as HTMLAnchorElement
    expect(bible).not.toBeNull()
    expect(bible.tagName).toBe("A")
    // Placeholder URL — content team to confirm before merge. If this value
    // changes intentionally, update it here AND the inline constant in
    // AskYoursPanel.tsx.
    expect(bible.getAttribute("href")).toBe(
      "https://issuesiface.com/bible-question?utm_source=forge-watch",
    )
    expect(bible.getAttribute("target")).toBe("_blank")
    expect(bible.getAttribute("rel")).toBe("noreferrer")
  })
})

describe("AskYoursPanel — lifecycle", () => {
  it("does not render any modal contents when open is false", () => {
    act(() => {
      root.render(<AskYoursPanel open={false} onClose={vi.fn()} />)
    })

    expect($('[data-testid="watch-ask-yours-panel"]')).toBeNull()
  })

  it("does not call onClose when open is true and untouched", () => {
    const onClose = vi.fn()
    act(() => {
      root.render(<AskYoursPanel open onClose={onClose} />)
    })
    expect(onClose).not.toHaveBeenCalled()
  })
})
