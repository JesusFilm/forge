import "server-only"
import { ApologistError } from "../protocol"

/** Bound reads before buffering and cancel the upstream on abort or early disposal. */
export function boundedStream(
  body: ReadableStream<Uint8Array>,
  limit: number,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  let bytes = 0
  let ended = false
  const release = () => {
    signal.removeEventListener("abort", abort)
    reader.releaseLock()
  }
  const abort = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener("abort", abort, { once: true })
  if (signal.aborted) abort()
  return new ReadableStream({
    async pull(controller) {
      try {
        signal.throwIfAborted()
        const next = await reader.read()
        if (ended) return
        signal.throwIfAborted()
        if (next.done) {
          ended = true
          release()
          controller.close()
          return
        }
        bytes += next.value.byteLength
        if (bytes > limit) throw new ApologistError("output_limit")
        controller.enqueue(next.value)
      } catch (error) {
        if (!ended) {
          ended = true
          await reader.cancel().catch(() => {})
          release()
          controller.error(error)
        }
      }
    },
    async cancel() {
      if (!ended) {
        ended = true
        await reader.cancel().catch(() => {})
        release()
      }
    },
  })
}

/** Read small JSON envelopes only after applying their byte and time ceilings. */
export async function readBoundedJson(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  signal: AbortSignal,
): Promise<unknown> {
  if (!body) throw new ApologistError("invalid_request")
  return new Response(boundedStream(body, limit, signal)).json()
}
