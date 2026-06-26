// Minimal SSE helpers (feat-205). Chat-local FORK of admin's parser in
// apps/admin/src/services/experience-ai/mastra-experience-chat-client.ts — if
// Mastra's frame format changes, both copies must change (drift risk).

/**
 * Parse a UTF-8 SSE stream, invoking `onFrame(event, data)` per complete frame.
 * Frames are separated by a blank line; an `event:` line is the discriminator
 * and a `data:` line carries the JSON payload. Frames with no `data:` line, or
 * whose data is not valid JSON, are skipped.
 */
// Cap the unflushed buffer so an upstream streaming a huge frame with no `\n\n`
// can't grow memory unbounded (the caller's timeout bounds wall-clock, not
// bytes). A real frame — a token or the result — is far smaller than this.
const MAX_BUFFER_BYTES = 512 * 1024

export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onFrame: (event: string, data: unknown) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let sep: number
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawFrame = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        let event = "message"
        const dataLines: string[] = []
        for (const line of rawFrame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim()
          else if (line.startsWith("data:"))
            dataLines.push(line.slice(5).trim())
        }
        if (dataLines.length === 0) continue
        let data: unknown
        try {
          data = JSON.parse(dataLines.join("\n"))
        } catch {
          continue
        }
        onFrame(event, data)
      }
      // Only the UNDRAINED tail counts: a single read of many complete frames
      // isn't an overflow. A tail past the cap = a separator-less giant frame.
      if (buffer.length > MAX_BUFFER_BYTES) {
        throw new Error("sse_buffer_overflow")
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** Encode one SSE frame (one `event:` + one JSON `data:` line + blank line). */
export function encodeSseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}
