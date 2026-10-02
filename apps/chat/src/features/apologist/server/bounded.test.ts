// @vitest-environment node
import { expect, it, vi } from "vitest"
import { readBoundedJson } from "./bounded"
it("cancels an oversized body without consuming the remaining bytes", async () => {
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(100))
    },
    cancel,
  })
  await expect(
    readBoundedJson(body, 99, new AbortController().signal),
  ).rejects.toThrow("output_limit")
  expect(cancel).toHaveBeenCalledOnce()
  expect(body.locked).toBe(false)
})
it("interrupts an idle reader on abort and releases its lock", async () => {
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({ cancel })
  const controller = new AbortController()
  const read = readBoundedJson(body, 100, controller.signal)
  controller.abort()
  await expect(read).rejects.toThrow()
  expect(cancel).toHaveBeenCalledOnce()
  expect(body.locked).toBe(false)
})
