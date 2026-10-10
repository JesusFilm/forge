export { RECOMMENDATION_EVIDENCE_BODY_BYTES } from "@/lib/recommendation-contracts"
export const RECOMMENDATION_DELIVERY_BODY_BYTES = 8 * 1024
export const RECOMMENDATION_DELIVERY_RESPONSE_BYTES = 64 * 1024

const MAX_JSON_DEPTH = 64
const JSON_WHITESPACE = new Set([" ", "\t", "\r", "\n"])

export class RecommendationRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
    this.name = "RecommendationRouteError"
  }
}

type StrictJsonOptions = {
  expectedOrigin: string
  maxBytes: number
}

/**
 * Enforces the shared browser-write policy before parsing any business input.
 * Header values that browsers coalesce with commas are deliberately rejected
 * instead of trying to select one interpretation.
 */
function validateRecommendationHeaders(
  request: Request,
  expectedOrigin: string,
): void {
  const origin = request.headers.get("origin")
  if (
    origin !== expectedOrigin &&
    !isForwardedLoopbackDevelopmentOrigin(origin, expectedOrigin)
  ) {
    throw new RecommendationRouteError(403, "invalid_origin")
  }
  if (request.headers.get("sec-fetch-site") !== "same-origin") {
    throw new RecommendationRouteError(403, "invalid_fetch_metadata")
  }
  if (request.headers.get("content-encoding") != null) {
    throw new RecommendationRouteError(415, "content_encoding_not_allowed")
  }
  if (
    request.headers.get("content-type")?.toLowerCase() !== "application/json"
  ) {
    throw new RecommendationRouteError(415, "invalid_content_type")
  }
}

function isForwardedLoopbackDevelopmentOrigin(
  origin: string | null,
  expectedOrigin: string,
): boolean {
  if (process.env.NODE_ENV === "production" || origin == null) return false
  try {
    const received = new URL(origin)
    const expected = new URL(expectedOrigin)
    return (
      received.origin === origin &&
      received.protocol === expected.protocol &&
      received.hostname === expected.hostname &&
      (received.hostname === "localhost" ||
        received.hostname === "127.0.0.1" ||
        received.hostname === "[::1]")
    )
  } catch {
    return false
  }
}

function declaredLength(request: Request, maxBytes: number): void {
  const raw = request.headers.get("content-length")
  if (raw == null) return
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) {
    throw new RecommendationRouteError(400, "invalid_content_length")
  }
  const bytes = Number(raw)
  if (!Number.isSafeInteger(bytes)) {
    throw new RecommendationRouteError(400, "invalid_content_length")
  }
  if (bytes > maxBytes) {
    throw new RecommendationRouteError(413, "body_too_large")
  }
}

async function readBoundedUtf8(request: Request, maxBytes: number) {
  const body = request.body
  if (body == null) throw new RecommendationRouteError(400, "invalid_json")
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new RecommendationRouteError(413, "body_too_large")
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof RecommendationRouteError) throw error
    throw new RecommendationRouteError(400, "invalid_json")
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new RecommendationRouteError(400, "invalid_json")
  }
}

class DuplicateKeyScanner {
  private index = 0

  constructor(private readonly text: string) {}

  scan(): void {
    this.value(0)
    this.whitespace()
    if (this.index !== this.text.length) this.invalid()
  }

  private value(depth: number): void {
    if (depth > MAX_JSON_DEPTH) this.invalid()
    this.whitespace()
    const token = this.text[this.index]
    if (token === "{") return this.object(depth + 1)
    if (token === "[") return this.array(depth + 1)
    if (token === '"') {
      this.string()
      return
    }
    if (
      this.consumeLiteral("true") ||
      this.consumeLiteral("false") ||
      this.consumeLiteral("null")
    ) {
      return
    }
    const number = this.text
      .slice(this.index)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)
    if (!number) this.invalid()
    this.index += number[0].length
  }

  private object(depth: number): void {
    this.index += 1
    this.whitespace()
    if (this.text[this.index] === "}") {
      this.index += 1
      return
    }
    const keys = new Set<string>()
    while (true) {
      this.whitespace()
      if (this.text[this.index] !== '"') this.invalid()
      const key = this.string()
      if (keys.has(key)) this.invalid()
      keys.add(key)
      this.whitespace()
      if (this.text[this.index] !== ":") this.invalid()
      this.index += 1
      this.value(depth)
      this.whitespace()
      const separator = this.text[this.index]
      if (separator === "}") {
        this.index += 1
        return
      }
      if (separator !== ",") this.invalid()
      this.index += 1
    }
  }

  private array(depth: number): void {
    this.index += 1
    this.whitespace()
    if (this.text[this.index] === "]") {
      this.index += 1
      return
    }
    while (true) {
      this.value(depth)
      this.whitespace()
      const separator = this.text[this.index]
      if (separator === "]") {
        this.index += 1
        return
      }
      if (separator !== ",") this.invalid()
      this.index += 1
    }
  }

  private string(): string {
    const start = this.index
    this.index += 1
    while (this.index < this.text.length) {
      const char = this.text[this.index]
      if (char === '"') {
        this.index += 1
        try {
          return JSON.parse(this.text.slice(start, this.index)) as string
        } catch {
          this.invalid()
        }
      }
      if (char === "\\") {
        this.index += 1
        const escaped = this.text[this.index]
        if (escaped === "u") {
          if (
            !/^[0-9a-fA-F]{4}$/.test(
              this.text.slice(this.index + 1, this.index + 5),
            )
          ) {
            this.invalid()
          }
          this.index += 5
          continue
        }
        if (!escaped || !'"\\/bfnrt'.includes(escaped)) this.invalid()
        this.index += 1
        continue
      }
      if (char == null || char.charCodeAt(0) < 0x20) this.invalid()
      this.index += 1
    }
    this.invalid()
  }

  private consumeLiteral(literal: string): boolean {
    if (!this.text.startsWith(literal, this.index)) return false
    this.index += literal.length
    return true
  }

  private whitespace(): void {
    while (JSON_WHITESPACE.has(this.text[this.index] ?? "")) this.index += 1
  }

  private invalid(): never {
    throw new RecommendationRouteError(400, "invalid_json")
  }
}

export async function readStrictRecommendationJson(
  request: Request,
  options: StrictJsonOptions,
): Promise<unknown> {
  validateRecommendationHeaders(request, new URL(options.expectedOrigin).origin)
  declaredLength(request, options.maxBytes)
  const text = await readBoundedUtf8(request, options.maxBytes)
  new DuplicateKeyScanner(text).scan()
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new RecommendationRouteError(400, "invalid_json")
  }
}
