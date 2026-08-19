/**
 * Byte-capped streaming JSON read for this feature's two HTTP clients.
 *
 * Deliberate divergence from `services/devotional/bounded-response.ts`: that
 * shared helper collapses EVERY body-read failure to `undefined`, including a
 * mid-body `TimeoutError`, so a genuine upstream-latency incident reaches the
 * caller as `parse_error`. On the Linear search path that is not cosmetic — a
 * non-retryable, non-ambiguous failure terminalizes the outbox row on its
 * first attempt and silently drops a signal R10 promises to keep.
 *
 * This copy rethrows the abort so the caller can classify it, matching
 * `mastra/langfuse-trace-retention.ts`. It lives here rather than fixing the
 * shared helper because that helper has six other consumers whose behaviour a
 * rethrow would change; consolidating them is tracked follow-up work in
 * `docs/solutions/conventions/single-service-http-client-result-union-convention.md`.
 */

/**
 * Reads at most `maxBytes`, cancelling the reader (and so the socket) the
 * moment the body crosses the cap. Returns `undefined` for any failure the
 * caller should treat as unusable output; rethrows only a timeout/abort.
 *
 * The catch must never log the caught error: a `JSON.parse` SyntaxError can
 * embed raw fragments of the upstream body.
 */
export async function readJsonBodyCappedOrThrow(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const stream = response.body
  if (!stream) return undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(merged))
  } catch (error) {
    const name = (error as { name?: string } | null | undefined)?.name
    if (name === "TimeoutError" || name === "AbortError") throw error
    return undefined
  } finally {
    try {
      reader?.releaseLock()
    } catch {
      // Cleanup must never escape the no-throw boundary.
    }
  }
}

/** True when a thrown value is a fetch abort rather than a body problem. */
export function isAbortLike(error: unknown): boolean {
  const name = (error as { name?: string } | null | undefined)?.name
  return name === "TimeoutError" || name === "AbortError"
}
