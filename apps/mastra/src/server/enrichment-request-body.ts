export async function readEnrichmentRequestBody(
  request: Request,
): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"))
  if (declared > 64 * 1024) return undefined
  const reader = request.body?.getReader()
  if (!reader) return undefined
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 64 * 1024) {
      await reader.cancel().catch(() => {})
      return undefined
    }
    chunks.push(value)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString()) as unknown
  } catch {
    return undefined
  }
}
