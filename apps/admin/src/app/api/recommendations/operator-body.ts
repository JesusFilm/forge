/** Bound operator input before JSON parsing, including requests without a length header. */
export async function readRecommendationOperatorBody(
  request: Request,
): Promise<
  { ok: true; value: unknown } | { ok: false; status: 400 | 413; error: string }
> {
  const reader = request.body?.getReader()
  if (!reader) return { ok: false, status: 400, error: "invalid_input" }
  try {
    const decoder = new TextDecoder()
    const chunks: string[] = []
    let bytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 65_536) {
        await reader.cancel()
        return { ok: false, status: 413, error: "body_too_large" }
      }
      chunks.push(decoder.decode(value, { stream: true }))
    }
    chunks.push(decoder.decode())
    return { ok: true, value: JSON.parse(chunks.join("")) }
  } catch {
    return { ok: false, status: 400, error: "invalid_input" }
  } finally {
    reader.releaseLock()
  }
}
