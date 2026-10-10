import { createHash } from "node:crypto"
import {
  FfmpegVisualFrameExtractor,
  type VisualFrameExtractor,
} from "./ffmpeg-visual-frame-extraction.js"
import {
  OFFICIAL_MEDIA_SIGNATURE_V3_ALGORITHM_VERSION,
  isVisualMediaSignatureAlgorithmVersion,
  type VisualFrameFingerprint,
} from "./visual-fingerprint.js"

export const UPLOAD_SIGNAL_ALGORITHM_VERSION = "official-media-signature-v1"
const DEFAULT_SAMPLE_BYTES = 262_144

export type UploadByteSample = {
  kind: "byte_sample_v1"
  sha256: string
  byteLength: number
  rangeStart: number
  rangeEnd: number
  contentType?: string
  complete: boolean
}

export type UploadSignals = {
  visualHashes: string[]
  audioFingerprints: string[]
  visualFingerprints?: VisualFrameFingerprint[]
  sampledByteHashes?: string[]
  byteSamples?: UploadByteSample[]
  transcriptText?: string
  durationMilliseconds?: number
  byteLength?: number
  contentType?: string
  algorithmVersion?: string
}

export type UploadSignalExtractionInput = {
  bytes: Buffer
  contentType: string
}

export type UploadSignalExtractor = {
  extract(input: UploadSignalExtractionInput): Promise<UploadSignals>
}

export type DeterministicUploadSignalExtractorOptions = {
  sampleBytes?: number
  algorithmVersion?: string
  visualFrameExtractor?: Pick<VisualFrameExtractor, "extractFromBytes"> | null
}

export class DeterministicUploadSignalExtractor implements UploadSignalExtractor {
  private readonly sampleBytes: number
  private readonly algorithmVersion: string
  private readonly visualFrameExtractor: Pick<
    VisualFrameExtractor,
    "extractFromBytes"
  > | null

  constructor(
    options: number | DeterministicUploadSignalExtractorOptions = {},
  ) {
    if (typeof options === "number") {
      this.sampleBytes = options
      this.algorithmVersion = UPLOAD_SIGNAL_ALGORITHM_VERSION
      this.visualFrameExtractor = null
      return
    }

    this.sampleBytes = options.sampleBytes ?? DEFAULT_SAMPLE_BYTES
    this.algorithmVersion =
      options.algorithmVersion ?? UPLOAD_SIGNAL_ALGORITHM_VERSION
    this.visualFrameExtractor =
      options.visualFrameExtractor === undefined
        ? this.defaultVisualFrameExtractor()
        : options.visualFrameExtractor
  }

  async extract({
    bytes,
    contentType,
  }: UploadSignalExtractionInput): Promise<UploadSignals> {
    const byteSamples = buildByteSamples(bytes, contentType, this.sampleBytes)
    const sampledByteHashes = byteSamples.map((sample) => sample.sha256)
    const durationMilliseconds = extractDurationMilliseconds(bytes, contentType)
    const visualFingerprints = await this.extractVisualFingerprints({
      bytes,
      contentType,
      durationMilliseconds,
    })

    return {
      visualHashes: isVisualMediaSignatureAlgorithmVersion(
        this.algorithmVersion,
      )
        ? visualFingerprints.map((fingerprint) => fingerprint.payload.phash)
        : sampledByteHashes,
      audioFingerprints: [],
      visualFingerprints,
      sampledByteHashes,
      byteSamples,
      transcriptText: extractTranscriptText(bytes, contentType),
      durationMilliseconds,
      byteLength: bytes.byteLength,
      contentType,
      algorithmVersion: this.algorithmVersion,
    }
  }

  private defaultVisualFrameExtractor(): Pick<
    VisualFrameExtractor,
    "extractFromBytes"
  > | null {
    if (!isVisualMediaSignatureAlgorithmVersion(this.algorithmVersion)) {
      return null
    }

    return new FfmpegVisualFrameExtractor({
      adaptiveSeeking:
        this.algorithmVersion === OFFICIAL_MEDIA_SIGNATURE_V3_ALGORITHM_VERSION,
    })
  }

  private async extractVisualFingerprints({
    bytes,
    contentType,
    durationMilliseconds,
  }: {
    bytes: Buffer
    contentType: string
    durationMilliseconds?: number
  }): Promise<VisualFrameFingerprint[]> {
    if (
      !isVisualMediaSignatureAlgorithmVersion(this.algorithmVersion) ||
      !this.visualFrameExtractor
    ) {
      return []
    }

    try {
      return await this.visualFrameExtractor.extractFromBytes({
        bytes,
        contentType,
        durationMilliseconds,
      })
    } catch {
      return []
    }
  }
}

function buildByteSamples(
  bytes: Buffer,
  contentType: string,
  sampleBytes: number,
): UploadByteSample[] {
  if (bytes.byteLength === 0 || sampleBytes <= 0) return []

  const endExclusive = Math.min(bytes.byteLength, sampleBytes)
  const sample = bytes.subarray(0, endExclusive)

  return [
    {
      kind: "byte_sample_v1",
      sha256: sha256Hex(sample),
      byteLength: sample.byteLength,
      rangeStart: 0,
      rangeEnd: sample.byteLength - 1,
      contentType,
      complete: sample.byteLength === bytes.byteLength,
    },
  ]
}

function extractDurationMilliseconds(
  bytes: Buffer,
  contentType: string,
): number | undefined {
  if (!isMp4ContentType(contentType)) return undefined

  return parseMp4DurationMilliseconds(bytes)
}

function parseMp4DurationMilliseconds(bytes: Buffer): number | undefined {
  const mvhd = findMp4Box(bytes, "mvhd", 0, bytes.byteLength)
  if (!mvhd) return undefined

  const version = bytes.readUInt8(mvhd.start)
  if (version === 0) {
    if (mvhd.end - mvhd.start < 20) return undefined
    const timescale = bytes.readUInt32BE(mvhd.start + 12)
    const duration = bytes.readUInt32BE(mvhd.start + 16)
    return durationToMilliseconds(duration, timescale)
  }

  if (version === 1) {
    if (mvhd.end - mvhd.start < 32) return undefined
    const timescale = bytes.readUInt32BE(mvhd.start + 20)
    const duration = bytes.readBigUInt64BE(mvhd.start + 24)
    return durationToMilliseconds(duration, timescale)
  }

  return undefined
}

function findMp4Box(
  bytes: Buffer,
  wantedType: string,
  start: number,
  end: number,
): { start: number; end: number } | undefined {
  let offset = start

  while (offset + 8 <= end) {
    const size = bytes.readUInt32BE(offset)
    const type = bytes.toString("ascii", offset + 4, offset + 8)
    let headerBytes = 8
    let boxEnd: number

    if (size === 1) {
      if (offset + 16 > end) return undefined
      const largeSize = bytes.readBigUInt64BE(offset + 8)
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return undefined
      headerBytes = 16
      boxEnd = offset + Number(largeSize)
    } else if (size === 0) {
      boxEnd = end
    } else {
      boxEnd = offset + size
    }

    if (boxEnd <= offset + headerBytes || boxEnd > end) return undefined

    const payload = { start: offset + headerBytes, end: boxEnd }
    if (type === wantedType) return payload

    if (isMp4ContainerBox(type)) {
      const nested = findMp4Box(bytes, wantedType, payload.start, payload.end)
      if (nested) return nested
    }

    offset = boxEnd
  }

  return undefined
}

function isMp4ContainerBox(type: string): boolean {
  return new Set(["moov", "trak", "mdia", "minf", "stbl", "edts"]).has(type)
}

function durationToMilliseconds(
  duration: number | bigint,
  timescale: number,
): number | undefined {
  if (timescale <= 0) return undefined

  const durationNumber =
    typeof duration === "bigint" ? Number(duration) : duration
  if (!Number.isSafeInteger(durationNumber) || durationNumber <= 0) {
    return undefined
  }

  return Math.round((durationNumber / timescale) * 1_000)
}

function extractTranscriptText(
  bytes: Buffer,
  contentType: string,
): string | undefined {
  if (!isSubtitleContentType(contentType)) return undefined

  const normalized = normalizeSubtitleText(bytes.toString("utf8"))
  return normalized.length > 0 ? normalized : undefined
}

function normalizeSubtitleText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^WEBVTT(?:\s|$)/i.test(line))
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !isCueTimingLine(line))
    .filter((line) => !/^NOTE(?:\s|$)/i.test(line))
    .map(removeSubtitleMarkup)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4_000)
}

function isCueTimingLine(line: string): boolean {
  return line.includes("-->") || line.includes("--!>")
}

function removeSubtitleMarkup(line: string): string {
  let plainText = ""
  let insideMarkup = false

  for (const character of line) {
    if (character === "<") {
      insideMarkup = true
      plainText += " "
      continue
    }

    if (insideMarkup) {
      if (character === ">") {
        insideMarkup = false
        plainText += " "
      }
      continue
    }

    plainText += character
  }

  return plainText
}

function isMp4ContentType(contentType: string): boolean {
  const normalized = normalizeContentType(contentType)
  return (
    normalized === "video/mp4" ||
    normalized === "audio/mp4" ||
    normalized === "application/mp4"
  )
}

function isSubtitleContentType(contentType: string): boolean {
  const normalized = normalizeContentType(contentType)
  return (
    normalized === "text/vtt" ||
    normalized === "application/x-subrip" ||
    normalized === "application/srt" ||
    normalized === "text/srt"
  )
}

function normalizeContentType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? ""
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}
