// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const realCrypto = globalThis.crypto

function insecureContextCrypto() {
  // Plain-HTTP origins and Firefox < 95 expose getRandomValues only.
  return {
    getRandomValues: (array: Uint8Array) => realCrypto.getRandomValues(array),
  }
}

async function loadViewerId() {
  vi.resetModules()
  return (await import("@/lib/viewer-id")).getViewerId
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("getViewerId", () => {
  it("persists one id across calls and module reloads when randomUUID is missing", async () => {
    vi.stubGlobal("crypto", insecureContextCrypto())
    const first = (await loadViewerId())()
    expect(first).toMatch(V4)
    expect((await loadViewerId())()).toBe(first)
    expect(window.localStorage.getItem("forge.viewer_id")).toBe(first)
  })

  it("keeps a stable in-memory id when storage is blocked and randomUUID is missing", async () => {
    vi.stubGlobal("crypto", insecureContextCrypto())
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError")
    })
    const getViewerId = await loadViewerId()
    const first = getViewerId()
    expect(first).toMatch(V4)
    // useSyncExternalStore needs the same snapshot on every read.
    expect(getViewerId()).toBe(first)
  })

  it("fails open to the empty label when no cryptographic source exists", async () => {
    vi.stubGlobal("crypto", undefined)
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError")
    })
    const getViewerId = await loadViewerId()
    expect(getViewerId()).toBe("")
    expect(getViewerId()).toBe("")
  })
})
