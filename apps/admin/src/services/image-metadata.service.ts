import { Buffer } from "node:buffer"

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

const SVG_BLUR_SIZE = 8
const DEFAULT_DOMINANT_COLOR = "#111827"

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

function imageDimensions(bytes: Uint8Array) {
  return (
    readPngDimensions(bytes) ??
    readJpegDimensions(bytes) ??
    readWebpDimensions(bytes) ?? { width: null, height: null }
  )
}

function svgBlurPlaceholder(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_BLUR_SIZE}" height="${SVG_BLUR_SIZE}" viewBox="0 0 ${SVG_BLUR_SIZE} ${SVG_BLUR_SIZE}"><rect width="${SVG_BLUR_SIZE}" height="${SVG_BLUR_SIZE}" fill="${color}"/></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
}

export function generateImageMetadata(
  bytes: Uint8Array,
): GeneratedImageMetadata {
  if (bytes.byteLength === 0) {
    throw new ImageMetadataError("Image bytes are empty")
  }

  const dimensions = imageDimensions(bytes)
  return {
    ...dimensions,
    blurDataUrl: svgBlurPlaceholder(DEFAULT_DOMINANT_COLOR),
    dominantColor: DEFAULT_DOMINANT_COLOR,
  }
}
