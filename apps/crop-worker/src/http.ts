import type { IncomingMessage, ServerResponse } from "node:http"

export type JsonBody = Record<string, unknown>

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: JsonBody,
): void {
  response.writeHead(statusCode, { "Content-Type": "application/json" })
  response.end(JSON.stringify(body))
}

export class RequestBodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds the limit of ${maxBytes} bytes`)
    this.name = "RequestBodyTooLargeError"
  }
}

export class UnsupportedContentTypeError extends Error {
  constructor(contentType: string) {
    super(`Unsupported content type: ${contentType}`)
    this.name = "UnsupportedContentTypeError"
  }
}

export class InvalidJsonBodyError extends Error {
  constructor() {
    super("Request body is not valid JSON")
    this.name = "InvalidJsonBodyError"
  }
}

const DEFAULT_MAX_JSON_BODY_BYTES = 1_000_000

export async function readJsonBody(
  request: IncomingMessage,
  maxBytes: number = DEFAULT_MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  const header = request.headers["content-type"]
  const contentType = (Array.isArray(header) ? header[0] : header) ?? ""

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new UnsupportedContentTypeError(contentType || "(missing)")
  }

  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += bytes.byteLength

    if (totalBytes > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes)
    }

    chunks.push(bytes)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  } catch {
    throw new InvalidJsonBodyError()
  }
}
