/**
 * Read a response body without ever buffering more than `maxBytes`.
 *
 * The reader is cancelled as soon as the body crosses the cap so the
 * underlying socket stops producing bytes. Every failure is deliberately
 * collapsed to `undefined`; callers map that value into their existing
 * transport/validation failure path. Caught errors must remain unlogged here:
 * JSON parse errors can include fragments of the upstream response body.
 */
export async function discardResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

export async function readResponseBytesCapped(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  const stream = response.body
  if (!stream) return undefined

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }

    const body = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return body
  } catch {
    return undefined
  } finally {
    try {
      reader?.releaseLock()
    } catch {
      // Cleanup is part of the no-throw boundary.
    }
  }
}

export async function readResponseTextCapped(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  const bytes = await readResponseBytesCapped(response, maxBytes)
  if (bytes === undefined) return undefined
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

export async function readResponseJsonCapped(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const text = await readResponseTextCapped(response, maxBytes)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
