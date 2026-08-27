export async function readBoundedSubtitleResponse(
  response: Response,
  maximumBytes: number,
) {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error("Response was too large")
  }
  if (!response.body) throw new Error("Response body missing")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let result = ""
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error("Response was too large")
    }
    result += decoder.decode(value, { stream: true })
  }
  return result + decoder.decode()
}
