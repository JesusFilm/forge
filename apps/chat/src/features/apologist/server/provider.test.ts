// @vitest-environment node
import { expect, it, vi } from "vitest"
import { streamAnswer } from "./provider"
const config = {
  baseURL: "https://gateway.test/v1",
  apiKey: "fixture-key",
  model: "configured/model",
  hosts: "gateway.test",
}
function chunk(content: string | null, finish_reason: string | null = null) {
  return `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: config.model, choices: [{ index: 0, delta: content === null ? {} : { content }, finish_reason }] })}\n\n`
}
it("serializes Core's system/model/token limit and consumes fragmented gateway frames", async () => {
  const wire = chunk("Answer") + chunk(null, "stop") + "data: [DONE]\n\n"
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const char of wire)
              controller.enqueue(new TextEncoder().encode(char))
            controller.close()
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  )
  const tokens = []
  for await (const token of streamAnswer(
    config,
    "System fixture",
    [{ role: "user", content: "Question" }],
    new AbortController().signal,
    fetcher,
  ))
    tokens.push(token)
  expect(tokens.join("")).toBe("Answer")
  const [url, init] = fetcher.mock.calls[0]!
  expect(String(url)).toBe("https://gateway.test/v1/chat/completions")
  expect(init?.redirect).toBe("error")
  expect(JSON.parse(String(init?.body))).toMatchObject({
    model: "configured/model",
    max_tokens: 512,
    stream: true,
    messages: [
      { role: "system", content: "System fixture" },
      { role: "user", content: "Question" },
    ],
  })
})
it("rejects early EOF rather than promising completion", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(chunk("partial"), {
      headers: { "content-type": "text/event-stream" },
    }),
  )
  await expect(
    (async () => {
      for await (const token of streamAnswer(
        config,
        "system",
        [{ role: "user", content: "Q" }],
        new AbortController().signal,
        fetcher,
      ))
        void token
    })(),
  ).rejects.toThrow("generation_failed")
})
it("refuses off-list destinations before sending credentials", async () => {
  const fetcher = vi.fn<typeof fetch>()
  await expect(
    (async () => {
      for await (const token of streamAnswer(
        { ...config, hosts: "other.test" },
        "system",
        [{ role: "user", content: "Q" }],
        new AbortController().signal,
        fetcher,
      ))
        void token
    })(),
  ).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
