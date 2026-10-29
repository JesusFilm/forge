/** Bounded JSON for the dry-run transport, including slow or chunked bodies. */
export async function readAutomationJson(
  request: Request | Response,
  maximumBytes = 8_192,
  signal?: AbortSignal,
): Promise<unknown> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json")
  ) {
    void request.body?.cancel().catch(() => undefined)
    return undefined
  }
  if (!request.body) return undefined
  const reader = request.body.getReader()
  const timeout = signal ?? AbortSignal.timeout(5_000)
  const aborted = () => {
    void reader.cancel().catch(() => undefined)
  }
  timeout.addEventListener("abort", aborted, { once: true })
  try {
    const chunks: Uint8Array[] = []
    let length = 0
    for (;;) {
      if (timeout.aborted) {
        aborted()
        return undefined
      }
      const { done, value } = await reader.read()
      if (timeout.aborted) {
        aborted()
        return undefined
      }
      if (done) break
      length += value.byteLength
      if (length > maximumBytes) {
        void reader.cancel().catch(() => undefined)
        return undefined
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown
  } catch {
    return undefined
  } finally {
    timeout.removeEventListener("abort", aborted)
    reader.releaseLock()
  }
}
