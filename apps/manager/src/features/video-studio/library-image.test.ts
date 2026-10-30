// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { LibraryImage } from "./library-image"
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => vi.unstubAllGlobals())
it("defers image transfers until visible, limits concurrency and releases blobs", async () => {
  const observers: ((entries: { isIntersecting: boolean }[]) => void)[] = []
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        observers.push(callback)
      }
      observe() {}
      disconnect() {}
    },
  )
  const completions: (() => void)[] = []
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) =>
        completions.push(() =>
          resolve({
            ok: true,
            headers: new Headers({ "x-studio-duration-ms": "125000" }),
            blob: async () => new Blob(["image"]),
          } as Response),
        ),
      ),
  )
  vi.stubGlobal("fetch", fetcher)
  const create = vi.fn(() => "blob:image")
  const revoke = vi.fn()
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke })
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const onDuration = vi.fn()
  const cards = (active: boolean) =>
    [0, 1, 2].map((i) =>
      React.createElement(LibraryImage, {
        key: i,
        active,
        onDuration,
        reference: {
          assetId: "image",
          versionId: `v${i}`,
          digest: "0".repeat(64),
        },
      }),
    )
  await act(async () => root.render(cards(true)))
  expect(fetcher).not.toHaveBeenCalled()
  await act(async () =>
    observers.forEach((observe) => observe([{ isIntersecting: true }])),
  )
  expect(fetcher).toHaveBeenCalledTimes(2)
  await act(async () => completions[0]!())
  expect(fetcher).toHaveBeenCalledTimes(3)
  await act(async () => {
    completions[1]!()
    completions[2]!()
  })
  expect(host.querySelectorAll("img")).toHaveLength(3)
  expect(onDuration).toHaveBeenCalledWith(125000)
  await act(async () => root.render(cards(false)))
  expect(revoke).toHaveBeenCalledTimes(3)
  expect(host.querySelectorAll("img")).toHaveLength(0)
  await act(async () => root.unmount())
  host.remove()
})
