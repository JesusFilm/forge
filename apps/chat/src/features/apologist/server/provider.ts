import "server-only"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { streamText } from "ai"
import { ApologistError, type ApologistMessage } from "../protocol"
import { boundedStream } from "./bounded"
import { pinnedUrl, type ProviderConfig } from "./config"

/** Adapt Core's model/system/512-token request into a bounded stream of answer text. */
export async function* streamAnswer(
  config: ProviderConfig,
  system: string,
  messages: ApologistMessage[],
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): AsyncGenerator<string> {
  const provider = createOpenAICompatible({
    name: "apologist",
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    fetch: async (input, init) => {
      pinnedUrl(String(input), config.hosts)
      const response = await fetcher(input, {
        ...init,
        signal,
        redirect: "error",
      })
      if (!response.ok || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel()
        throw new ApologistError("generation_failed")
      }
      if (!response.body) throw new ApologistError("generation_failed")
      return new Response(boundedStream(response.body, 1024 * 1024, signal), {
        status: response.status,
        headers: response.headers,
      })
    },
  })
  const result = streamText({
    model: provider.chatModel(config.model),
    system,
    messages,
    maxOutputTokens: 512,
    maxRetries: 0,
    abortSignal: signal,
    onError: () => {},
  })
  const reader = result.fullStream.getReader()
  let finished = false
  let chars = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      const part = next.value
      if (part.type === "error" || part.type === "abort")
        throw new ApologistError("generation_failed")
      if (part.type === "text-delta") {
        chars += part.text.length
        if (chars > 8192) throw new ApologistError("output_limit")
        yield part.text
      }
      if (part.type === "finish") {
        if (part.finishReason !== "stop" && part.finishReason !== "length")
          throw new ApologistError("generation_failed")
        finished = true
      }
    }
    if (!finished || !chars) throw new ApologistError("generation_failed")
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
