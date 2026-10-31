import { afterEach, expect, it, vi } from "vitest"
import { createStudioSourceDownload } from "./studio-broker"

afterEach(() => vi.unstubAllGlobals())
it("counts and fetches repeated source segments once within a preparation", async () => {
  const fetcher = vi.fn(async () => new Response("123456"))
  vi.stubGlobal("fetch", fetcher)
  const download = createStudioSourceDownload(undefined, 12)
  const first = await download("https://stream.mux.com/one.ts")
  expect(await download("https://stream.mux.com/one.ts")).toBe(first)
  await download("https://stream.mux.com/two.ts")
  expect(await download("https://stream.mux.com/one.ts")).toBe(first)
  expect(fetcher).toHaveBeenCalledTimes(2)
  await expect(download("https://stream.mux.com/three.ts")).rejects.toThrow(
    "byte budget",
  )
})
it("retains per-read limits and cancellation for cached bytes", async () => {
  const fetcher = vi.fn(async () => new Response("123456"))
  vi.stubGlobal("fetch", fetcher)
  const controller = new AbortController()
  const download = createStudioSourceDownload(controller.signal, 12)
  await download("https://stream.mux.com/one.ts")
  await expect(download("https://stream.mux.com/one.ts", 5)).rejects.toThrow(
    "byte budget",
  )
  await expect(
    download("https://stream.mux.com.evil.example/one.ts"),
  ).rejects.toThrow("Unapproved")
  controller.abort()
  await expect(download("https://stream.mux.com/one.ts")).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it("does not reuse source bytes across preparations", async () => {
  const fetcher = vi.fn(async () => new Response("123456"))
  vi.stubGlobal("fetch", fetcher)
  await createStudioSourceDownload(
    undefined,
    12,
  )("https://stream.mux.com/one.ts")
  await createStudioSourceDownload(
    undefined,
    12,
  )("https://stream.mux.com/one.ts")
  expect(fetcher).toHaveBeenCalledTimes(2)
})
