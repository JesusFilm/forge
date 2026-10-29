import { EXECUTION_BODY_MAX_BYTES as CALLBACK_BODY_MAX_BYTES } from "./enrichment-execution-contract"
type JsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413; error: string }

export async function readBoundedJsonBody(
  request: Request,
): Promise<JsonBodyResult> {
  const contentLength = request.headers.get("content-length")
  if (contentLength && Number(contentLength) > CALLBACK_BODY_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "Callback body is too large",
    }
  }

  const reader = request.body?.getReader()
  if (!reader) {
    return { ok: false, status: 400, error: "Invalid JSON body" }
  }

  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    received += value.byteLength
    if (received > CALLBACK_BODY_MAX_BYTES) {
      await reader.cancel().catch(() => {})
      return {
        ok: false,
        status: 413,
        error: "Callback body is too large",
      }
    }
    chunks.push(value)
  }

  const body = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return {
      ok: true,
      body: JSON.parse(new TextDecoder().decode(body)) as unknown,
    }
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON body" }
  }
}
