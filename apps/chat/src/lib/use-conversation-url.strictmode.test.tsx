// StrictMode coverage for the feat-209 URL-sync hook: exactly ONE live
// listener per event after the mount double-cycle, and sync fires after re-arm.
// Needs RTL's reactStrictMode option, NEVER a <StrictMode> wrapper (CLAUDE.md).
import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useConversationUrl } from "./use-conversation-url"

const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

type HookProps = {
  enabled: boolean
  activeId: string
  serverPersisted: boolean
}

function setup(initialProps: HookProps) {
  const adoptConversation = vi.fn(() => true)
  const newConversation = vi.fn()
  const onHistoryNavigation = vi.fn()
  const pushSpy = vi.spyOn(window.history, "pushState")
  const replaceSpy = vi.spyOn(window.history, "replaceState")
  const view = renderHook(
    (props: HookProps) =>
      useConversationUrl({
        ...props,
        adoptConversation,
        newConversation,
        onHistoryNavigation,
      }),
    { reactStrictMode: true, initialProps },
  )
  return {
    view,
    adoptConversation,
    newConversation,
    onHistoryNavigation,
    pushSpy,
    replaceSpy,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  // Restore the jsdom URL — URL state leaks between tests otherwise.
  window.history.replaceState(null, "", "/")
})

describe("useConversationUrl under dev StrictMode", () => {
  it("leaves exactly ONE live popstate listener after the mount double-cycle", () => {
    window.history.replaceState(null, "", "/")
    const s = setup({
      enabled: true,
      activeId: "local-1",
      serverPersisted: false,
    })

    window.history.replaceState(null, "", `/c/${ID_A}`)
    window.dispatchEvent(new PopStateEvent("popstate"))
    // Two surviving listeners would adopt (and announce) twice.
    expect(s.adoptConversation).toHaveBeenCalledTimes(1)
    expect(s.adoptConversation).toHaveBeenCalledWith(ID_A)
    expect(s.onHistoryNavigation).toHaveBeenCalledTimes(1)
  })

  it("leaves exactly ONE live pageshow listener after the mount double-cycle", () => {
    window.history.replaceState(null, "", "/")
    // jsdom pins location.reload non-configurable, but window.location itself
    // is a configurable accessor — swap the whole object, restore after.
    const descriptor = Object.getOwnPropertyDescriptor(window, "location")
    if (!descriptor) throw new Error("window.location descriptor missing")
    const reloadSpy = vi.fn()
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    })
    try {
      setup({ enabled: true, activeId: "local-1", serverPersisted: false })
      const event = new Event("pageshow")
      Object.defineProperty(event, "persisted", { value: true })
      window.dispatchEvent(event)
      // Two surviving listeners would reload twice.
      expect(reloadSpy).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window, "location", descriptor)
    }
  })

  it("still syncs after the re-arm: an activeId change produces exactly one push", () => {
    window.history.replaceState(null, "", `/c/${ID_A}`)
    const s = setup({ enabled: true, activeId: ID_A, serverPersisted: true })
    // The double mount cycle observed a canonical URL — no writes.
    expect(s.pushSpy).not.toHaveBeenCalled()
    expect(s.replaceSpy).not.toHaveBeenCalled()

    s.view.rerender({ enabled: true, activeId: ID_B, serverPersisted: true })
    expect(s.pushSpy).toHaveBeenCalledTimes(1)
    expect(s.pushSpy).toHaveBeenCalledWith(
      null,
      "",
      `${window.location.origin}/c/${ID_B}`,
    )
    expect(s.replaceSpy).not.toHaveBeenCalled()
  })
})
