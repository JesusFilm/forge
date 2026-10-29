/** Streamed byte and time limits apply to success and error bodies alike. */
export async function readAutomationDryRunJson(
  message: Request | Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  if (
    !message.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json") ||
    !message.body
  ) {
    void message.body?.cancel().catch(() => undefined)
    return undefined
  }
  const reader = message.body.getReader()
  const abort = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal.addEventListener("abort", abort, { once: true })
  try {
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      if (signal.aborted) {
        abort()
        return undefined
      }
      const { done, value } = await reader.read()
      if (signal.aborted) {
        abort()
        return undefined
      }
      if (done) break
      size += value.byteLength
      if (size > maximumBytes) {
        abort()
        return undefined
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
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
    signal.removeEventListener("abort", abort)
    reader.releaseLock()
  }
}
