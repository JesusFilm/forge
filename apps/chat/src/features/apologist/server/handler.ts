import "server-only"
import { encodeSseFrame } from "@/lib/sse"
import { ApologistError, validateHistory } from "../protocol"
import { readBoundedJson } from "./bounded"
import {
  providerConfig,
  promptConfig,
  type ProviderConfig,
  type PromptConfig,
} from "./config"
import { resolvePrompt } from "./prompt"
import { streamAnswer } from "./provider"

const headers = { "Cache-Control": "no-store" }

/** Authorized, bounded route core; exactly one terminal frame while the client is connected. */
export async function handleApologist(
  request: Request,
  allowed: boolean,
  dependencies: {
    provider?: () => ProviderConfig | null
    prompt?: () => PromptConfig | null
    resolve?: typeof resolvePrompt
    answer?: typeof streamAnswer
    timeoutMs?: number
  } = {},
): Promise<Response> {
  const refuse = (reason: string, status: number) =>
    Response.json({ reason }, { status, headers })
  if (!allowed) return refuse("denied", 403)
  const config = (dependencies.provider ?? providerConfig)()
  if (!config) return refuse("unavailable", 503)
  const controller = new AbortController()
  const timeout = AbortSignal.timeout(dependencies.timeoutMs ?? 95000)
  const signal = AbortSignal.any([request.signal, controller.signal, timeout])
  let messages
  try {
    if (Number(request.headers.get("content-length")) > 256 * 1024)
      return refuse("input_limit", 413)
    messages = validateHistory(
      await readBoundedJson(request.body, 256 * 1024, signal),
    )
  } catch (error) {
    const reason =
      error instanceof ApologistError ? error.reason : "invalid_request"
    return refuse(
      reason === "output_limit" ? "input_limit" : reason,
      reason === "output_limit" ||
        reason === "input_limit" ||
        reason === "history_limit"
        ? 413
        : 400,
    )
  }
  const history = messages
  let disconnected = false
  const body = new ReadableStream<Uint8Array>({
    start(output) {
      void (async () => {
        const encoder = new TextEncoder()
        const emit = (event: string, data: unknown) => {
          if (!disconnected)
            output.enqueue(encoder.encode(encodeSseFrame(event, data)))
        }
        try {
          const prompt = await (dependencies.resolve ?? resolvePrompt)(
            (dependencies.prompt ?? promptConfig)(),
            signal,
          )
          signal.throwIfAborted()
          emit("meta", prompt.meta)
          for await (const text of (dependencies.answer ?? streamAnswer)(
            config,
            prompt.system,
            history,
            signal,
          )) {
            signal.throwIfAborted()
            emit("token", { text })
          }
          signal.throwIfAborted()
          emit("done", {})
        } catch (error) {
          const reason = timeout.aborted
            ? "timeout"
            : signal.aborted
              ? "cancelled"
              : error instanceof ApologistError
                ? error.reason
                : "generation_failed"
          emit("error", { reason })
        } finally {
          controller.abort()
          if (!disconnected) output.close()
        }
      })()
    },
    cancel() {
      disconnected = true
      controller.abort()
    },
  })
  return new Response(body, {
    headers: {
      ...headers,
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  })
}
