// @vitest-environment node
import { expect, it, vi } from "vitest"
import { createPromptReader } from "./prompt"
const config = {
  baseURL: "https://prompt.test",
  publicKey: "test",
  secretKey: "test",
  hosts: "prompt.test",
}
it("compiles production English/ESV, expires successes and never serves stale after failure", async () => {
  let now = 0
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        type: "text",
        version: 8,
        prompt: "Use {{language}} and {{translation}}",
      }),
    )
    .mockResolvedValueOnce(new Response("", { status: 404 }))
  const read = createPromptReader(fetcher, () => now)
  const signal = new AbortController().signal
  expect(await read(config, signal)).toEqual({
    system: "Use English and ESV",
    meta: { source: "production", version: 8 },
  })
  await read(config, signal)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(String(fetcher.mock.calls[0]?.[0])).toContain("label=production")
  now = 60001
  expect((await read(config, signal)).meta.source).toBe("fallback")
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it.each([
  { type: "chat", prompt: [] },
  { type: "text", prompt: "{{unknown}}", version: 2 },
  { type: "text", prompt: "@@@langfusePrompt:name=x@@@", version: 1 },
])("visibly falls back on unsupported prompt shapes", async (value) => {
  const read = createPromptReader(
    vi.fn<typeof fetch>().mockResolvedValue(Response.json(value)),
  )
  const result = await read(config, new AbortController().signal)
  expect(result.meta.source).toBe("fallback")
  expect(result.system).toContain("Quote from the ESV Bible.")
  expect(result.system).toContain(
    "If the user writes in a different language, respond in that language instead.",
  )
})
