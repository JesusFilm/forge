import { Buffer } from "node:buffer"
import sharp from "sharp"

export type GeneratedImageMetadata = {
  width: number | null
  height: number | null
  blurDataUrl: string
  dominantColor: string
}

export class ImageMetadataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ImageMetadataError"
  }
}

const DEFAULT_DOMINANT_COLOR = "#111827"
const BLUR_IMAGE_WIDTH = 24

function readPngDimensions(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes)
  const pngSignature = "89504e470d0a1a0a"
  if (
    buffer.length < 24 ||
    buffer.subarray(0, 8).toString("hex") !== pngSignature
  ) {
    return null
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function readJpegDimensions(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes)
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null
  }

  let offset = 2
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = buffer[offset + 1]
    const length = buffer.readUInt16BE(offset + 2)
    if (length < 2) return null

    if (
      marker != null &&
      ((marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf))
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      }
    }

    offset += 2 + length
  }

  return null
}

function readWebpDimensions(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes)
  if (
    buffer.length < 30 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    return null
  }

  const chunk = buffer.subarray(12, 16).toString("ascii")
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    }
  }

  if (chunk === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    }
  }

  if (chunk === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    }
  }

  return null
}

function headerImageDimensions(bytes: Uint8Array) {
  return (
    readPngDimensions(bytes) ??
    readJpegDimensions(bytes) ??
    readWebpDimensions(bytes) ?? { width: null, height: null }
  )
}

async function imageDimensions(bytes: Uint8Array) {
  const metadata = await sharp(Buffer.from(bytes), {
    animated: false,
  }).metadata()
  return {
    width: metadata.width ?? headerImageDimensions(bytes).width,
    height: metadata.height ?? headerImageDimensions(bytes).height,
  }
}

function hexByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0")
}

function rgbHex(red: number, green: number, blue: number) {
  return `#${hexByte(red)}${hexByte(green)}${hexByte(blue)}`
}

async function decodeDominantColor(bytes: Uint8Array): Promise<string> {
  const { data } = await sharp(Buffer.from(bytes), { animated: false })
    .rotate()
    .flatten({ background: DEFAULT_DOMINANT_COLOR })
    .resize(1, 1, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  if (data.length >= 3) {
    return rgbHex(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0)
  }

  return DEFAULT_DOMINANT_COLOR
}

export async function generateDominantColor(
  bytes: Uint8Array,
): Promise<string> {
  try {
    return await decodeDominantColor(bytes)
  } catch {
    return DEFAULT_DOMINANT_COLOR
  }
}

export async function generateDominantColorStrict(
  bytes: Uint8Array,
): Promise<string> {
  return decodeDominantColor(bytes)
}

async function blurDataUrl(bytes: Uint8Array) {
  const output = await sharp(Buffer.from(bytes), { animated: false })
    .rotate()
    .flatten({ background: DEFAULT_DOMINANT_COLOR })
    .resize({
      width: BLUR_IMAGE_WIDTH,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 35, chromaSubsampling: "4:2:0", mozjpeg: true })
    .toBuffer()

  return `data:image/jpeg;base64,${output.toString("base64")}`
}

export async function generateImageMetadata(
  bytes: Uint8Array,
): Promise<GeneratedImageMetadata> {
  if (bytes.byteLength === 0) {
    throw new ImageMetadataError("Image bytes are empty")
  }

  try {
    const dimensions = await imageDimensions(bytes)
    const [generatedBlurDataUrl, generatedDominantColor] = await Promise.all([
      blurDataUrl(bytes),
      generateDominantColor(bytes),
    ])

    return {
      ...dimensions,
      blurDataUrl: generatedBlurDataUrl,
      dominantColor: generatedDominantColor,
    }
  } catch (error) {
    if (error instanceof ImageMetadataError) throw error
    throw new ImageMetadataError(
      `Unable to generate image metadata: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}
