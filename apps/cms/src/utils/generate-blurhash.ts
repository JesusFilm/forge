import { encode } from "blurhash"
import sharp from "sharp"

const BLURHASH_WIDTH = 32
const BLURHASH_X = 4
const BLURHASH_Y = 3

/**
 * Generate a blurhash string from an image URL.
 * Fetches the image, resizes to a tiny thumbnail, and encodes to blurhash.
 */
export async function generateBlurhash(imageUrl: string): Promise<string> {
  const url = ensureVariant(imageUrl)

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status}): ${url}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())

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

/** Append /public variant if the URL is a bare Cloudflare Image Delivery URL. */
function ensureVariant(url: string): string {
  if (!url.includes("imagedelivery.net")) return url

  // Already has a variant (e.g. /public, /thumbnail, or flexible variant params)
  const parts = url.split("/")
  const lastSegment = parts[parts.length - 1] ?? ""
  if (lastSegment.includes("=") || lastSegment === "public") return url

  return `${url}/public`
}
