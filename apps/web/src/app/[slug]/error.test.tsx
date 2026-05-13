/**
 * @vitest-environment jsdom
 *
 * UB7 — slug-page error boundary tests.
 *
 * The boundary catches typed `WatchPageAdminError` from admin-mode
 * fetches and renders one of two static UX shapes (NOT_FOUND →
 * <ExperienceEmpty>, UNAVAILABLE → <ExperienceError> + reset). Anything
 * else re-throws to Next's segment-default boundary.
 *
 * Information-disclosure invariant: `error.message` MUST NEVER appear in
 * the rendered DOM for either typed branch. Snapshot-style assertions
 * check this directly.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WatchPageAdminError } from "@/lib/content"

import SlugPageError from "./error"

describe("SlugPageError boundary", () => {
  let container: HTMLDivElement
  let root: Root
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    // Suppress NODE_ENV !== "production" console.error from the boundary.
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    consoleErrorSpy.mockRestore()
  })

  // ---------------------------------------------------------------------------
  // Happy path NOT_FOUND → <ExperienceEmpty>
  // ---------------------------------------------------------------------------

  it("renders ExperienceEmpty for WatchPageAdminError('NOT_FOUND')", () => {
    const reset = vi.fn()
    act(() => {
      root.render(
        <SlugPageError
          error={new WatchPageAdminError("NOT_FOUND")}
          reset={reset}
        />,
      )
    })
    expect(container.textContent).toContain("No experience content available")
    // No reset button on the empty state — matches Strapi-mode inline behavior.
    expect(container.querySelector("button")).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // Happy path UNAVAILABLE → <ExperienceError> + reset button
  // ---------------------------------------------------------------------------

  it("renders ExperienceError + reset button for WatchPageAdminError('UNAVAILABLE')", () => {
    const reset = vi.fn()
    act(() => {
      root.render(
        <SlugPageError
          error={new WatchPageAdminError("UNAVAILABLE")}
          reset={reset}
        />,
      )
    })
    expect(container.textContent).toContain("Failed to load experience")
    const button = container.querySelector("button")
    expect(button).not.toBeNull()
    expect(button?.textContent).toContain("Try again")
  })

  it("reset callback fires when the Try again button is clicked", () => {
    const reset = vi.fn()
    act(() => {
      root.render(
        <SlugPageError
          error={new WatchPageAdminError("UNAVAILABLE")}
          reset={reset}
        />,
      )
    })
    const button = container.querySelector("button")
    expect(button).not.toBeNull()
    act(() => {
      button?.click()
    })
    expect(reset).toHaveBeenCalledTimes(1)
  })

  // ---------------------------------------------------------------------------
  // Information disclosure — error.message MUST NOT reach the DOM
  // ---------------------------------------------------------------------------

  it("NEVER renders error.message in DOM for NOT_FOUND (typed branch)", () => {
    const reset = vi.fn()
    const SECRET_FRAGMENT = "INTERNAL_STACK_FRAGMENT_DO_NOT_LEAK_12345"
    const errorWithSecret = new WatchPageAdminError("NOT_FOUND", {
      cause: new Error(SECRET_FRAGMENT),
    })
    // The error's own message is built from the code; verify the secret
    // from `cause` doesn't propagate either.
    errorWithSecret.message = SECRET_FRAGMENT
    act(() => {
      root.render(<SlugPageError error={errorWithSecret} reset={reset} />)
    })
    expect(container.textContent).not.toContain(SECRET_FRAGMENT)
  })

  it("NEVER renders error.message in DOM for UNAVAILABLE (typed branch)", () => {
    const reset = vi.fn()
    const SECRET_FRAGMENT = "DB_CONNECTION_STRING_DO_NOT_LEAK_67890"
    const errorWithSecret = new WatchPageAdminError("UNAVAILABLE")
    errorWithSecret.message = SECRET_FRAGMENT
    act(() => {
      root.render(<SlugPageError error={errorWithSecret} reset={reset} />)
    })
    expect(container.textContent).not.toContain(SECRET_FRAGMENT)
  })

  // ---------------------------------------------------------------------------
  // Catch-all: non-typed errors re-throw to Next's default boundary
  // ---------------------------------------------------------------------------

  it("re-throws when error is a generic Error (not WatchPageAdminError)", () => {
    const reset = vi.fn()
    expect(() => {
      act(() => {
        root.render(
          <SlugPageError error={new Error("unexpected")} reset={reset} />,
        )
      })
    }).toThrow("unexpected")
  })

  it("re-throws when WatchPageAdminError has an unknown code (defensive)", () => {
    const reset = vi.fn()
    // Forge an off-band code value via Object.defineProperty — guards
    // against a future change widening the code union without updating
    // this boundary's switch arms. The readonly TS modifier blocks
    // simple assignment; defineProperty bypasses TS but exercises the
    // runtime branch.
    const offBandError = new WatchPageAdminError("NOT_FOUND")
    Object.defineProperty(offBandError, "code", {
      value: "UNKNOWN_NEW_CODE",
      writable: true,
      configurable: true,
    })
    expect(() => {
      act(() => {
        root.render(<SlugPageError error={offBandError} reset={reset} />)
      })
    }).toThrow()
  })
})
