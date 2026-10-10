/**
 * Byte-capped buffered response reads for the eval's HTTP clients.
 *
 * The repo law (apps/mastra/CLAUDE.md, "Byte-cap buffered upstream HTTP
 * reads"): any `await response.json()` / `.text()` buffers the WHOLE body
 * into the heap before any slicing, so a misbehaving upstream returning a
 * multi-GB body can OOM the process. Stream the body with a byte counter and
 * `await reader.cancel()` (abort the socket, not merely stop reading) the
 * instant it crosses the cap. Modeled on the reference implementation in
 * `src/services/jesusfilm-rag-client.ts` (`readJsonBodyCapped`).
 *
 * Returns `undefined` on EVERY failure mode (absent body, read error,
 * over-cap, decode error, JSON parse error) so callers ride their existing
 * graceful-failure path. The catch swallows silently and MUST NOT log the
 * caught error: a `JSON.parse` SyntaxError can embed raw body fragments.
 */

async function readBytesCapped(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  const stream = response.body
  if (!stream) return undefined
  // `reader` is acquired INSIDE the try and released in a guarded `finally`
  // so both ends of the no-throw boundary are structural: a `getReader()`
  // throw is swallowed to undefined, and `releaseLock()` (which throws if a
  // read is still pending) can never escape and mask the graceful return.
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
        // Abort the underlying stream (not merely stop reading) so the
        // socket stops filling the heap.
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
    return merged
  } catch {
    return undefined
  } finally {
    try {
      reader?.releaseLock()
    } catch {
      // Cleanup must never escape — see the no-throw boundary note above.
    }
  }
}

/** JSON-parse a response body bounded at `maxBytes`; `undefined` on any failure. */
export async function readJsonBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const bytes = await readBytesCapped(response, maxBytes)
  if (bytes == null) return undefined
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return undefined
  }
}

/** Decode a response body as text bounded at `maxBytes`; `undefined` on failure. */
export async function readTextBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  const bytes = await readBytesCapped(response, maxBytes)
  if (bytes == null) return undefined
  try {
    return new TextDecoder().decode(bytes)
  } catch {
    return undefined
  }
}
