export const OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION =
  "official-media-signature-v2"
export const OFFICIAL_MEDIA_SIGNATURE_V3_ALGORITHM_VERSION =
  "official-media-signature-v3"
export const VISUAL_FRAME_FINGERPRINT_KIND = "visual_frame_phash_v2"
export const VISUAL_FRAME_FINGERPRINT_WIDTH = 8
export const VISUAL_FRAME_FINGERPRINT_HEIGHT = 8

export type VisualFrameFingerprintPayload = {
  kind: typeof VISUAL_FRAME_FINGERPRINT_KIND
  phash: string
  frameWidth: number
  frameHeight: number
}

export type VisualFrameFingerprint = {
  offsetMilliseconds: number
  durationMilliseconds?: number | null
  payload: VisualFrameFingerprintPayload
}

export type VisualFrameFingerprintInput = {
  bytes: Uint8Array
  width?: number
  height?: number
}

export function isVisualMediaSignatureAlgorithmVersion(
  algorithmVersion: string,
): boolean {
  return (
    algorithmVersion === OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION ||
    algorithmVersion === OFFICIAL_MEDIA_SIGNATURE_V3_ALGORITHM_VERSION
  )
}

export class VisualFingerprintError extends Error {
  constructor(
    readonly code:
      | "visual_fingerprint_invalid_hash"
      | "visual_fingerprint_invalid_dimensions"
      | "visual_fingerprint_invalid_frame_bytes",
    message: string,
  ) {
    super(message)
    this.name = "VisualFingerprintError"
  }
}

export function buildVisualFrameFingerprintPayload({
  bytes,
  width = VISUAL_FRAME_FINGERPRINT_WIDTH,
  height = VISUAL_FRAME_FINGERPRINT_HEIGHT,
}: VisualFrameFingerprintInput): VisualFrameFingerprintPayload {
  return {
    kind: VISUAL_FRAME_FINGERPRINT_KIND,
    phash: averageHashGrayscaleFrame(bytes, width, height),
    frameWidth: width,
    frameHeight: height,
  }
}

export function averageHashGrayscaleFrame(
  bytes: Uint8Array,
  width = VISUAL_FRAME_FINGERPRINT_WIDTH,
  height = VISUAL_FRAME_FINGERPRINT_HEIGHT,
): string {
  assertFrameShape(bytes, width, height)

  const average =
    bytes.reduce((total, value) => total + value, 0) / bytes.byteLength
  const hex: string[] = []
  let nibble = 0
  let bitOffset = 0

  for (const value of bytes) {
    if (value > average) {
      nibble |= 1 << (3 - bitOffset)
    }

    bitOffset += 1
    if (bitOffset === 4) {
      hex.push(nibble.toString(16))
      nibble = 0
      bitOffset = 0
    }
  }

  if (bitOffset > 0) {
    hex.push(nibble.toString(16))
  }

  return hex.join("")
}

export function parseVisualFrameFingerprintPayload(
  value: unknown,
): VisualFrameFingerprintPayload | undefined {
  if (!isRecord(value)) return undefined
  if (value.kind !== VISUAL_FRAME_FINGERPRINT_KIND) return undefined
  if (typeof value.phash !== "string") return undefined
  if (!isVisualFingerprintHash(value.phash)) return undefined
  if (!isPositiveInteger(value.frameWidth)) return undefined
  if (!isPositiveInteger(value.frameHeight)) return undefined

  return {
    kind: VISUAL_FRAME_FINGERPRINT_KIND,
    phash: value.phash.toLowerCase(),
    frameWidth: value.frameWidth,
    frameHeight: value.frameHeight,
  }
}

export function isVisualFingerprintHash(value: string): boolean {
  return /^[0-9a-f]{16}$/i.test(value)
}

export function hammingDistance(left: string, right: string): number {
  if (!isVisualFingerprintHash(left) || !isVisualFingerprintHash(right)) {
    throw new VisualFingerprintError(
      "visual_fingerprint_invalid_hash",
      "Visual fingerprint hashes must be 16 hex characters",
    )
  }

  let distance = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftNibble = Number.parseInt(left[index]!, 16)
    const rightNibble = Number.parseInt(right[index]!, 16)
    distance += NIBBLE_BIT_COUNTS[leftNibble ^ rightNibble]!
  }

  return distance
}

export function visualFingerprintSimilarity(
  left: string,
  right: string,
): number {
  if (!isVisualFingerprintHash(left) || !isVisualFingerprintHash(right)) {
    return 0
  }

  return 1 - hammingDistance(left, right) / 64
}

function assertFrameShape(
  bytes: Uint8Array,
  width: number,
  height: number,
): void {
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    throw new VisualFingerprintError(
      "visual_fingerprint_invalid_dimensions",
      "Frame dimensions must be positive integers",
    )
  }

  const expectedByteLength = width * height
  if (bytes.byteLength !== expectedByteLength) {
    throw new VisualFingerprintError(
      "visual_fingerprint_invalid_frame_bytes",
      `Expected ${expectedByteLength} grayscale bytes, received ${bytes.byteLength}`,
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value > 0
}

const NIBBLE_BIT_COUNTS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]
