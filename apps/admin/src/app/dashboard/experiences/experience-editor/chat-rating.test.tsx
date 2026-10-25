// @vitest-environment jsdom

/**
 * U6 — <ChatRating> component tests.
 *
 * Verifies: ratability gate, happy-path toggle, clear via active
 * thumb, comment seeding, optimistic update + revert on error.
 * Uses raw React DOM (no @testing-library/react) to match the
 * apps/admin convention established in
 * `experience-chat-panel.test.tsx`.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ChatRating } from "./chat-rating"
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

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
})

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function failResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function find<T extends HTMLElement>(id: string): T {
  const el = container.querySelector(`[data-testid="${id}"]`)
  if (!el) throw new Error(`No element with data-testid='${id}'`)
  return el as T
}

async function flush() {
  // Two microtasks for the optimistic update + revert paths.
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe("ChatRating", () => {
  it("renders nothing for a non-ratable producer (unknown agent id)", () => {
    // experience-default-chat is now ratable. The remaining non-ratable
    // signals are an unknown producer id (this test) and producedBy=null
    // for historic rows (the next test).
    act(() => {
      root.render(
        <ChatRating
          messageId="m1"
          producedBy="some-future-agent"
          initial={null}
        />,
      )
    })
    expect(container.firstChild).toBeNull()
  })

  it("renders nothing for producedBy=null", () => {
    act(() => {
      root.render(
        <ChatRating messageId="m1" producedBy={null} initial={null} />,
      )
    })
    expect(container.firstChild).toBeNull()
  })

  it("renders both thumbs for a ratable producer", () => {
    act(() => {
      root.render(
        <ChatRating
          messageId="m1"
          producedBy="multi-step-draft"
          initial={null}
        />,
      )
    })
    expect(find("chat-rating-up-m1")).toBeTruthy()
    expect(find("chat-rating-down-m1")).toBeTruthy()
  })

  it("seeds active state from `initial`", () => {
    act(() => {
      root.render(
        <ChatRating
          messageId="m1"
          producedBy="multi-step-draft"
          initial={{
            score: 1,
            comment: "nice",
            updatedAt: "2026-05-25T10:00:00Z",
          }}
        />,
      )
    })
    expect(find("chat-rating-up-m1").getAttribute("aria-pressed")).toBe("true")
    expect(find("chat-rating-down-m1").getAttribute("aria-pressed")).toBe(
      "false",
    )
    expect((find("chat-rating-comment-m1") as HTMLTextAreaElement).value).toBe(
      "nice",
    )
  })

  it("clicking 👍 submits POST with score=1 and marks the button active", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(okResponse({ rating: { score: 1, comment: null } }))
    act(() => {
      root.render(
        <ChatRating
          messageId="m1"
          producedBy="multi-step-draft"
          initial={null}
          fetchImpl={fetchMock}
        />,
      )
    })

    await act(async () => {
      find("chat-rating-up-m1").click()
      await flush()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("/api/experience-chat/messages/m1/rating")
    expect((init as RequestInit).method).toBe("POST")
    expect((init as RequestInit).body).toBe(
      JSON.stringify({ score: 1, comment: null }),
    )
    expect(find("chat-rating-up-m1").getAttribute("aria-pressed")).toBe("true")
  })

  it("clicking the active thumb again issues DELETE (clear)", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(okResponse({ rating: null }))
    act(() => {
      root.render(
        <ChatRating
          messageId="m1"
          producedBy="multi-step-draft"
          initial={{ score: 1, comment: null, updatedAt: "x" }}
          fetchImpl={fetchMock}
        />,
      )
    })

    await act(async () => {
      find("chat-rating-up-m1").click()
      await flush()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]!
    expect((init as RequestInit).method).toBe("DELETE")
  })

  it("reverts to previous state when POST returns 500", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(failResponse(500, { error: "Boom" }))
    act(() => {
      root.render(
        <ChatRating
          messageId="m1"
          producedBy="multi-step-draft"
          initial={null}
          fetchImpl={fetchMock}
        />,
      )
    })

    await act(async () => {
      find("chat-rating-up-m1").click()
      await flush()
    })

    expect(find("chat-rating-up-m1").getAttribute("aria-pressed")).toBe("false")
    expect(find("chat-rating-error-m1").textContent).toBe("Boom")
  })

  it("flipping 👍 → 👎 submits POST with score=0", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(okResponse({ rating: { score: 0, comment: null } }))
    act(() => {
      root.render(
        <ChatRating
          messageId="m1"
          producedBy="multi-step-draft"
          initial={{ score: 1, comment: null, updatedAt: "x" }}
          fetchImpl={fetchMock}
        />,
      )
    })

    await act(async () => {
      find("chat-rating-down-m1").click()
      await flush()
    })

    const [, init] = fetchMock.mock.calls[0]!
    expect((init as RequestInit).method).toBe("POST")
    expect((init as RequestInit).body).toBe(
      JSON.stringify({ score: 0, comment: null }),
    )
  })
})
