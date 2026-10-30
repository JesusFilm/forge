export const MANAGER_API_MAX_BODY_BYTES = 32 * 1024

export async function readBoundedManagerJson(
  request: Request,
  maxBytes = MANAGER_API_MAX_BODY_BYTES,
): Promise<unknown> {
  const declared = request.headers.get("content-length")
  if (declared != null) {
    const declaredBytes = Number(declared)
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      await request.body?.cancel()
      throw new Error("manager_request_body_too_large")
    }
  }

  if (!request.body) throw new Error("manager_request_body_missing")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        throw new Error("manager_request_body_too_large")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))
}
