// Contract suite for the feat-209 URL-sync hook (U3, KTD1/KTD2). jsdom lacks
// Next's history patch, so these tests drive the RAW history API and dispatch
// PopStateEvent by hand; the no-remount/no-reload claims are browser-verified.
import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useConversationUrl } from "./use-conversation-url"

const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const ID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

type HookProps = {
  enabled: boolean
  activeId: string
  serverPersisted: boolean
}

function expectedUrl(pathAndQuery: string): string {
  return `${window.location.origin}${pathAndQuery}`
}

/**
 * Render the hook with history spies installed AFTER the test set its
 * starting URL (each test arranges the URL with the REAL replaceState
 * first). Spies call through, so the jsdom URL stays live under writes.
 */
function setup(
  initialProps: HookProps,
  { adoptResult = true }: { adoptResult?: boolean } = {},
) {
  const adoptConversation = vi.fn(() => adoptResult)
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
    { initialProps },
  )
  // Simulate a browser traversal half: the URL changes BEFORE popstate fires.
  // Goes through the call-through spy, so counters are cleared after.
  const arriveAt = (path: string) => {
    window.history.replaceState(null, "", path)
    pushSpy.mockClear()
    replaceSpy.mockClear()
  }
  return {
    view,
    adoptConversation,
    newConversation,
    onHistoryNavigation,
    pushSpy,
    replaceSpy,
    arriveAt,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  // Restore the jsdom URL — URL state leaks between tests otherwise.
  window.history.replaceState(null, "", "/")
})

describe("useConversationUrl — snapshot → history writes (KTD2)", () => {
  it("pushes /c/<id> when the active conversation changes; an identical rerender writes nothing", () => {
    window.history.replaceState(null, "", `/c/${ID_A}`)
    const s = setup({ enabled: true, activeId: ID_A, serverPersisted: true })
    expect(s.pushSpy).not.toHaveBeenCalled()
    expect(s.replaceSpy).not.toHaveBeenCalled()

    s.view.rerender({ enabled: true, activeId: ID_B, serverPersisted: true })
    expect(s.pushSpy).toHaveBeenCalledTimes(1)
    expect(s.pushSpy).toHaveBeenCalledWith(null, "", expectedUrl(`/c/${ID_B}`))

    // Re-render with the same snapshot: no duplicate history entries.
    s.view.rerender({ enabled: true, activeId: ID_B, serverPersisted: true })
    expect(s.pushSpy).toHaveBeenCalledTimes(1)
    expect(s.replaceSpy).not.toHaveBeenCalled()
    // Ordinary prop-driven syncs never announce (scenario 11's second half).
    expect(s.onHistoryNavigation).not.toHaveBeenCalled()
  })

  it("replaces (not pushes) when serverPersisted flips true on the SAME active conversation", () => {
    window.history.replaceState(null, "", "/")
    const s = setup({ enabled: true, activeId: ID_A, serverPersisted: false })

    s.view.rerender({ enabled: true, activeId: ID_A, serverPersisted: true })
    expect(s.replaceSpy).toHaveBeenCalledTimes(1)
    expect(s.replaceSpy).toHaveBeenCalledWith(
      null,
      "",
      expectedUrl(`/c/${ID_A}`),
    )
    expect(s.pushSpy).not.toHaveBeenCalled()
    expect(s.onHistoryNavigation).not.toHaveBeenCalled()
  })

  it("writes nothing on rerenders with an unchanged snapshot (a background flip never reaches the hook)", () => {
    // The shell derives serverPersisted from the ACTIVE conversation only —
    // a background conversation's stamp flip rerenders with identical props
    // here, so the hook must observe no change and write nothing.
    window.history.replaceState(null, "", `/c/${ID_A}`)
    const s = setup({ enabled: true, activeId: ID_A, serverPersisted: true })

    s.view.rerender({ enabled: true, activeId: ID_A, serverPersisted: true })
    s.view.rerender({ enabled: true, activeId: ID_A, serverPersisted: true })
    expect(s.pushSpy).not.toHaveBeenCalled()
    expect(s.replaceSpy).not.toHaveBeenCalled()
  })

  it("pushes / when a local unsent conversation becomes active; repeated / derivations write nothing", () => {
    window.history.replaceState(null, "", `/c/${ID_A}`)
    const s = setup({ enabled: true, activeId: ID_A, serverPersisted: true })

    s.view.rerender({ enabled: true, activeId: ID_B, serverPersisted: false })
    expect(s.pushSpy).toHaveBeenCalledTimes(1)
    expect(s.pushSpy).toHaveBeenCalledWith(null, "", expectedUrl("/"))

    // Another local unsent conversation derives "/" again: paths match, so
    // nothing is written even though activeId changed.
    s.view.rerender({ enabled: true, activeId: ID_C, serverPersisted: false })
    expect(s.pushSpy).toHaveBeenCalledTimes(1)
    expect(s.replaceSpy).not.toHaveBeenCalled()
  })

  it("never emits a non-UUID active id into the address bar (fail-closed write symmetry)", () => {
    // serverPersisted with a non-UUID id must derive "/" (a replace back off
    // the stale /c/ path), never a /c/local-not-a-uuid write.
    window.history.replaceState(null, "", `/c/${ID_A}`)
    const s = setup({
      enabled: true,
      activeId: "local-not-a-uuid",
      serverPersisted: true,
    })

    expect(s.replaceSpy).toHaveBeenCalledTimes(1)
    expect(s.replaceSpy).toHaveBeenCalledWith(null, "", expectedUrl("/"))
    expect(s.pushSpy).not.toHaveBeenCalled()
  })

  it("keeps the query string and hash intact on a push (URL-object construction)", () => {
    window.history.replaceState(null, "", "/?signin=failed&keep=1#anchor")
    const s = setup({
      enabled: true,
      activeId: "local-1",
      serverPersisted: false,
    })

    s.view.rerender({ enabled: true, activeId: ID_A, serverPersisted: true })
    expect(s.pushSpy).toHaveBeenCalledTimes(1)
    expect(s.pushSpy).toHaveBeenCalledWith(
      null,
      "",
      expectedUrl(`/c/${ID_A}?signin=failed&keep=1#anchor`),
    )
  })

  it("pins KTD2's sync semantics: 'changed since the last sync' means the last OBSERVED snapshot, not the last write", () => {
    window.history.replaceState(null, "", `/c/${ID_A}`)
    const s = setup({ enabled: true, activeId: ID_A, serverPersisted: true })

    // Browser Back to "/": URL changes, popstate fires, no write happens
    // (the handler only calls session actions).
    s.arriveAt("/")
    window.dispatchEvent(new PopStateEvent("popstate"))
    expect(s.newConversation).toHaveBeenCalledTimes(1)
    expect(s.pushSpy).not.toHaveBeenCalled()
    expect(s.replaceSpy).not.toHaveBeenCalled()

    // The shell reacts with a NEW local active conversation: paths already
    // match ("/"), so this run writes nothing — but it must still be OBSERVED.
    s.view.rerender({ enabled: true, activeId: ID_C, serverPersisted: false })
    expect(s.pushSpy).not.toHaveBeenCalled()
    expect(s.replaceSpy).not.toHaveBeenCalled()

    // First send reaches the server: the mint must REPLACE — a push here
    // would break AE2's Back-leaves-the-app promise.
    s.view.rerender({ enabled: true, activeId: ID_C, serverPersisted: true })
    expect(s.replaceSpy).toHaveBeenCalledTimes(1)
    expect(s.replaceSpy).toHaveBeenCalledWith(
      null,
      "",
      expectedUrl(`/c/${ID_C}`),
    )
    expect(s.pushSpy).not.toHaveBeenCalled()
  })
})

describe("useConversationUrl — popstate → session actions", () => {
  it("adopts a valid /c/<id> with the LOWERCASED id and announces the navigation", () => {
    window.history.replaceState(null, "", "/")
    const s = setup({
      enabled: true,
      activeId: "local-1",
      serverPersisted: false,
    })

    s.arriveAt(`/c/${ID_A.toUpperCase()}`)
    window.dispatchEvent(new PopStateEvent("popstate"))
    expect(s.adoptConversation).toHaveBeenCalledTimes(1)
    expect(s.adoptConversation).toHaveBeenCalledWith(ID_A)
    expect(s.newConversation).not.toHaveBeenCalled()
    expect(s.onHistoryNavigation).toHaveBeenCalledTimes(1)
    // A successful adopt writes nothing — and the handler NEVER pushes.
    expect(s.pushSpy).not.toHaveBeenCalled()
    expect(s.replaceSpy).not.toHaveBeenCalled()
  })

  it("normalizes a refused adopt to / via replaceState — never pushState — and starts fresh", () => {
    window.history.replaceState(null, "", "/")
    const s = setup(
      { enabled: true, activeId: "local-1", serverPersisted: false },
      { adoptResult: false },
    )

    s.arriveAt(`/c/${ID_A}?keep=1`)
    window.dispatchEvent(new PopStateEvent("popstate"))
    expect(s.adoptConversation).toHaveBeenCalledWith(ID_A)
    expect(s.replaceSpy).toHaveBeenCalledTimes(1)
    // URL-object construction on the refusal path too: the query survives.
    expect(s.replaceSpy).toHaveBeenCalledWith(null, "", expectedUrl("/?keep=1"))
    expect(s.newConversation).toHaveBeenCalledTimes(1)
    expect(s.onHistoryNavigation).toHaveBeenCalledTimes(1)
    expect(s.pushSpy).not.toHaveBeenCalled()
  })

  it("treats /c/<garbage> and nested /c/<id>/extra as fresh-conversation traversals, never adoption", () => {
    window.history.replaceState(null, "", "/")
    const s = setup({
      enabled: true,
      activeId: "local-1",
      serverPersisted: false,
    })

    s.arriveAt("/c/not-a-uuid")
    window.dispatchEvent(new PopStateEvent("popstate"))
    expect(s.adoptConversation).not.toHaveBeenCalled()
    expect(s.newConversation).toHaveBeenCalledTimes(1)
    expect(s.onHistoryNavigation).toHaveBeenCalledTimes(1)

    s.arriveAt(`/c/${ID_A}/extra`)
    window.dispatchEvent(new PopStateEvent("popstate"))
    expect(s.adoptConversation).not.toHaveBeenCalled()
    expect(s.newConversation).toHaveBeenCalledTimes(2)
    expect(s.pushSpy).not.toHaveBeenCalled()
  })

  it("treats / as a fresh-conversation traversal without touching adoptConversation", () => {
    window.history.replaceState(null, "", `/c/${ID_A}`)
    const s = setup({ enabled: true, activeId: ID_A, serverPersisted: true })

    s.arriveAt("/")
    window.dispatchEvent(new PopStateEvent("popstate"))
    expect(s.adoptConversation).not.toHaveBeenCalled()
    expect(s.newConversation).toHaveBeenCalledTimes(1)
    expect(s.onHistoryNavigation).toHaveBeenCalledTimes(1)
    expect(s.pushSpy).not.toHaveBeenCalled()
    expect(s.replaceSpy).not.toHaveBeenCalled()
  })
})

describe("useConversationUrl — enabled: false is fully inert (R3)", () => {
  it("never writes, registers no listeners, and ignores popstate", () => {
    // URL and snapshot deliberately DISAGREE — an enabled hook would write.
    window.history.replaceState(null, "", `/c/${ID_A}`)
    const addSpy = vi.spyOn(window, "addEventListener")
    const s = setup({ enabled: false, activeId: ID_B, serverPersisted: true })

    expect(s.pushSpy).not.toHaveBeenCalled()
    expect(s.replaceSpy).not.toHaveBeenCalled()
    const registered = addSpy.mock.calls.map(([type]) => type)
    expect(registered).not.toContain("popstate")
    expect(registered).not.toContain("pageshow")

    window.dispatchEvent(new PopStateEvent("popstate"))
    expect(s.adoptConversation).not.toHaveBeenCalled()
    expect(s.newConversation).not.toHaveBeenCalled()
    expect(s.onHistoryNavigation).not.toHaveBeenCalled()
  })
})

describe("useConversationUrl — pageshow bfcache guard (R9)", () => {
  // jsdom pins location.reload non-configurable, but window.location itself
  // is a configurable accessor — swap the whole object, restore after.
  function stubReload() {
    const descriptor = Object.getOwnPropertyDescriptor(window, "location")
    if (!descriptor) throw new Error("window.location descriptor missing")
    const spy = vi.fn()
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: spy },
    })
    return {
      spy,
      restore: () => Object.defineProperty(window, "location", descriptor),
    }
  }

  function pageShowEvent(persisted: boolean): Event {
    const event = new Event("pageshow")
    Object.defineProperty(event, "persisted", { value: persisted })
    return event
  }

  it("reloads on a bfcache restore (persisted: true)", () => {
    window.history.replaceState(null, "", "/")
    const stub = stubReload()
    try {
      setup({ enabled: true, activeId: "local-1", serverPersisted: false })
      window.dispatchEvent(pageShowEvent(true))
      expect(stub.spy).toHaveBeenCalledTimes(1)
    } finally {
      stub.restore()
    }
  })

  it("does nothing on an ordinary pageshow (persisted: false)", () => {
    window.history.replaceState(null, "", "/")
    const stub = stubReload()
    try {
      setup({ enabled: true, activeId: "local-1", serverPersisted: false })
      window.dispatchEvent(pageShowEvent(false))
      expect(stub.spy).not.toHaveBeenCalled()
    } finally {
      stub.restore()
    }
  })
})
