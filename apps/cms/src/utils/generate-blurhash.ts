import { encode } from "blurhash"
import sharp from "sharp"

const BLURHASH_WIDTH = 32
const BLURHASH_X = 4
const BLURHASH_Y = 3
const FETCH_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024 // 10 MB

const ALLOWED_HOSTS = new Set(["imagedelivery.net"])

/**
 * Generate a blurhash string from an image URL.
 * Fetches the image, resizes to a tiny thumbnail, and encodes to blurhash.
 */
export async function generateBlurhash(imageUrl: string): Promise<string> {
  const url = ensureVariant(imageUrl)
  validateUrl(url)

  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status})`)
  }

  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.startsWith("image/")) {
    throw new Error(`Unexpected content-type: ${contentType}`)
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0")
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Image too large: ${contentLength} bytes`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Image too large: ${buffer.byteLength} bytes`)
  }

  const { data, info } = await sharp(buffer)
    .resize(BLURHASH_WIDTH, BLURHASH_WIDTH, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  return encode(
    new Uint8ClampedArray(data),
    info.width,
    info.height,
    BLURHASH_X,
    BLURHASH_Y,
  )
}

/** Validate URL is https and on an allowed host. */
function validateUrl(url: string): void {
  const parsed = new URL(url)
  if (parsed.protocol !== "https:") {
    throw new Error(`Only https URLs are allowed`)
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`Host not allowed: ${parsed.hostname}`)
  }
}

/** Append /public variant if the URL is a bare Cloudflare Image Delivery URL. */
function ensureVariant(url: string): string {
  const parsed = new URL(url)
  if (parsed.hostname !== "imagedelivery.net") return url

  // Already has a variant (e.g. /public, /thumbnail, or flexible variant params)
  const segments = parsed.pathname.split("/")
  const lastSegment = segments[segments.length - 1] ?? ""
  if (lastSegment.includes("=") || lastSegment === "public") return url

  return `${url}/public`
}
