export async function readJsonLimited(request: Request): Promise<unknown> {
  const limit = 64 * 1024
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > limit)
    throw new Error("request_too_large")
  if (!request.body) return null
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > limit) throw new Error("request_too_large")
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}
