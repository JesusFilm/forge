export async function readBodyLimited(
  request: Request,
  limit: number,
  timeoutMs = 10_000,
): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > limit)
    throw new Error("request_too_large")
  if (!request.body) throw new Error("empty_file")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("request_timeout")), timeoutMs)
  })
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), expired])
      if (done) break
      length += value.length
      if (length > limit) throw new Error("request_too_large")
      chunks.push(value)
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined)
    throw error
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
  return Buffer.concat(chunks, length)
}

export async function readJsonLimited(request: Request): Promise<unknown> {
  if (!request.body) return null
  const bytes = await readBodyLimited(request, 64 * 1024)
  return JSON.parse(bytes.toString("utf8")) as unknown
}
