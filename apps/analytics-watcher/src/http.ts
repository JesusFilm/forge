import { WatcherError } from "./config.js"

export type Fetch = typeof fetch
export async function requestJson(
  url: string,
  init: RequestInit,
  service: string,
  fetchImpl: Fetch = fetch,
): Promise<unknown> {
  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok)
      throw new WatcherError(`${service} returned HTTP ${response.status}.`)
    // Bound both the read duration (signal above) and memory before parsing.
    const reader = response.body?.getReader()
    if (!reader)
      throw new WatcherError(`${service} returned an empty response.`)
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > 256_000)
          throw new WatcherError(`${service} response exceeded the size limit.`)
        chunks.push(chunk.value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  } catch (error) {
    if (error instanceof WatcherError) throw error
    throw new WatcherError(
      `${service} request failed or returned invalid JSON.`,
    )
  }
}
