/**
 * @vitest-environment jsdom
 */
import { act, createElement } from "react"
import { createRoot, hydrateRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const STORAGE_KEY = "forge.watch.role"

type RoleModule = typeof import("@/components/watch/watch-role")

/** The store is module state, so every test gets a fresh copy of it. */
async function loadStore(): Promise<RoleModule> {
  vi.resetModules()
  return import("@/components/watch/watch-role")
}

const mounted: { root: Root; container: HTMLElement }[] = []

function renderHook<T>(hook: () => T) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const entry = { root, container }
  mounted.push(entry)
  const result = { current: undefined as T }
  function Probe() {
    result.current = hook()
    return null
  }
  act(() => root.render(createElement(Probe)))
  return {
    result,
    unmount() {
      act(() => root.unmount())
      container.remove()
      mounted.splice(mounted.indexOf(entry), 1)
    },
  }
}

function cleanup() {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
}

function visit(search: string) {
  window.history.replaceState(null, "", `/${search}`)
}

function storageEvent(newValue: string | null) {
  act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", { key: STORAGE_KEY, newValue }),
    )
  })
}

beforeEach(() => {
  window.localStorage.clear()
  visit("")
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe("role resolution", () => {
  it("defaults to Explore", async () => {
    const { useWatchRole } = await loadStore()
    const { result } = renderHook(() => useWatchRole())
    expect(result.current.role).toBe("explore")
  })

  it("prefers a valid explicit `as` over a different saved role", async () => {
    window.localStorage.setItem(STORAGE_KEY, "grow")
    visit("?as=partner")
    const { useWatchRole } = await loadStore()
    const { result } = renderHook(() => useWatchRole())
    expect(result.current.role).toBe("partner")
  })

  it("falls back to the saved role when `as` is malformed", async () => {
    window.localStorage.setItem(STORAGE_KEY, "share")
    visit("?as=wizard")
    const { useWatchRole } = await loadStore()
    const { result } = renderHook(() => useWatchRole())
    expect(result.current.role).toBe("share")
  })

  it("falls back to Explore when `as` and the saved value are both malformed", async () => {
    window.localStorage.setItem(STORAGE_KEY, "wizard")
    visit("?as=PARTNER")
    const { useWatchRole } = await loadStore()
    const { result } = renderHook(() => useWatchRole())
    expect(result.current.role).toBe("explore")
  })

  it("never persists a URL hint by itself", async () => {
    visit("?as=partner")
    const { useWatchRole } = await loadStore()
    renderHook(() => useWatchRole())
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it("does not infer a role from utm parameters or the referrer", async () => {
    visit("?utm_source=church-partner")
    const { useWatchRole } = await loadStore()
    const { result } = renderHook(() => useWatchRole())
    expect(result.current.role).toBe("explore")
  })
})

describe("setWatchRole", () => {
  it("switches every mounted consumer and persists only the role id", async () => {
    const { useWatchRole, setWatchRole } = await loadStore()
    const first = renderHook(() => useWatchRole())
    const second = renderHook(() => useWatchRole())

    act(() => setWatchRole("share"))

    expect(first.result.current.role).toBe("share")
    expect(second.result.current.role).toBe("share")
    expect(window.localStorage.length).toBe(1)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("share")
  })

  it("remembers the choice for the next visit", async () => {
    const store = await loadStore()
    const first = renderHook(() => store.useWatchRole())
    act(() => store.setWatchRole("grow"))
    first.unmount()

    const next = await loadStore()
    const { result } = renderHook(() => next.useWatchRole())
    expect(result.current.role).toBe("grow")
  })

  it("lets an explicit choice replace the `as` hint that opened the page", async () => {
    visit("?as=partner")
    const { useWatchRole, setWatchRole } = await loadStore()
    const { result } = renderHook(() => useWatchRole())
    expect(result.current.role).toBe("partner")

    act(() => setWatchRole("explore"))

    expect(result.current.role).toBe("explore")
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("explore")
  })

  it("keeps switching for the session when storage is blocked", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError")
    })
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError")
    })
    const { useWatchRole, setWatchRole } = await loadStore()
    const mounted = renderHook(() => useWatchRole())
    expect(mounted.result.current.role).toBe("explore")

    act(() => setWatchRole("partner"))
    expect(mounted.result.current.role).toBe("partner")

    // A later page in the same session still sees the choice.
    mounted.unmount()
    const remounted = renderHook(() => useWatchRole())
    expect(remounted.result.current.role).toBe("partner")
  })
})

describe("storage events from another tab", () => {
  it("changes the role, and restores Explore when the preference is deleted", async () => {
    const { useWatchRole } = await loadStore()
    const { result } = renderHook(() => useWatchRole())
    expect(result.current.role).toBe("explore")

    window.localStorage.setItem(STORAGE_KEY, "grow")
    storageEvent("grow")
    expect(result.current.role).toBe("grow")

    window.localStorage.removeItem(STORAGE_KEY)
    storageEvent(null)
    expect(result.current.role).toBe("explore")
  })

  it("follows a clear() from another tab", async () => {
    window.localStorage.setItem(STORAGE_KEY, "share")
    const { useWatchRole } = await loadStore()
    const { result } = renderHook(() => useWatchRole())
    expect(result.current.role).toBe("share")

    window.localStorage.clear()
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }))
    })
    expect(result.current.role).toBe("explore")
  })

  it("ignores a malformed value written by another tab", async () => {
    window.localStorage.setItem(STORAGE_KEY, "share")
    const { useWatchRole } = await loadStore()
    const { result } = renderHook(() => useWatchRole())

    window.localStorage.setItem(STORAGE_KEY, "wizard")
    storageEvent("wizard")
    expect(result.current.role).toBe("explore")
  })

  it("does not re-read storage for unrelated keys", async () => {
    const { useWatchRole } = await loadStore()
    const { result } = renderHook(() => useWatchRole())
    const getItem = vi.spyOn(window.localStorage, "getItem")

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "something.else", newValue: "x" }),
      )
    })

    expect(getItem).not.toHaveBeenCalled()
    expect(result.current.role).toBe("explore")
  })

  it("holds one storage listener while mounted and releases it with the last consumer", async () => {
    const { useWatchRole } = await loadStore()
    const add = vi.spyOn(window, "addEventListener")
    const remove = vi.spyOn(window, "removeEventListener")
    const storageCalls = (spy: typeof add) =>
      spy.mock.calls.filter(([type]) => type === "storage").length

    const first = renderHook(() => useWatchRole())
    const second = renderHook(() => useWatchRole())
    expect(storageCalls(add)).toBe(1)

    first.unmount()
    expect(storageCalls(remove)).toBe(0)
    second.unmount()
    expect(storageCalls(remove)).toBe(1)
  })
})

describe("hydration", () => {
  it("renders Explore on the server and reports not hydrated", async () => {
    window.localStorage.setItem(STORAGE_KEY, "partner")
    visit("?as=grow")
    const { useWatchRole } = await loadStore()
    function Probe() {
      const { role, hydrated } = useWatchRole()
      return createElement("p", null, `${role}:${hydrated}`)
    }

    expect(renderToString(createElement(Probe))).toBe("<p>explore:false</p>")
  })

  it("hydrates server markup without a mismatch, then shows the client role", async () => {
    window.localStorage.setItem(STORAGE_KEY, "partner")
    const { useWatchRole } = await loadStore()
    function Probe() {
      const { role, hydrated } = useWatchRole()
      return createElement("p", null, `${role}:${hydrated}`)
    }
    const container = document.createElement("div")
    document.body.append(container)
    // What the server sent: always Explore, never hydrated.
    container.innerHTML = renderToString(createElement(Probe))
    expect(container.textContent).toBe("explore:false")
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})

    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(container, createElement(Probe))
    })

    expect(errors).not.toHaveBeenCalled()
    expect(container.textContent).toBe("partner:true")
    act(() => root?.unmount())
    container.remove()
  })
})

describe("isWatchRole", () => {
  it("accepts exactly the four role ids", async () => {
    const { isWatchRole } = await loadStore()
    for (const id of ["explore", "grow", "share", "partner"]) {
      expect(isWatchRole(id)).toBe(true)
    }
    for (const bad of ["use", "Explore", "", null, undefined, 3, {}]) {
      expect(isWatchRole(bad)).toBe(false)
    }
  })

  it("lists the roles in their authored order", async () => {
    const { WATCH_ROLES } = await loadStore()
    expect(WATCH_ROLES.map((r) => r.id)).toEqual([
      "explore",
      "grow",
      "share",
      "partner",
    ])
    for (const role of WATCH_ROLES) {
      expect(role.label).toBeTruthy()
      expect(role.chip).toBeTruthy()
    }
  })
})
