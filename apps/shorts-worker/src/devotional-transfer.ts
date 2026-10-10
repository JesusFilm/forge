import { createHash } from "node:crypto"
import { once } from "node:events"
import { createReadStream, createWriteStream } from "node:fs"
import { rm, stat } from "node:fs/promises"
import { isIP } from "node:net"
import { Readable, Transform } from "node:stream"

import {
  devotionalAttemptIdentitySchema,
  devotionalWorkspaceArtifactRefSchema,
  devotionalWorkspaceTransferSchema,
  type DevotionalAttemptIdentity,
  type DevotionalWorkspaceArtifactRef,
  type DevotionalWorkspaceInputGrant,
  type DevotionalWorkspaceOutputGrant,
  type DevotionalWorkspaceReadGrant,
  type DevotionalWorkspaceTransfer,
} from "@forge/devotional-workspace"

import { WorkerError } from "./errors.js"

const TRANSFER_TIMEOUT_MS = 20 * 60_000
const MAX_CAPABILITY_LIFETIME_MS = 90 * 60_000

export { devotionalAttemptIdentitySchema }
export const devotionalWorkspaceRefSchema = devotionalWorkspaceArtifactRefSchema

export { devotionalWorkspaceTransferSchema }
export type { DevotionalWorkspaceTransfer }
export type DevotionalWorkspaceRef = DevotionalWorkspaceArtifactRef
export type DevotionalReadGrant = DevotionalWorkspaceReadGrant
export type DevotionalInputGrant = DevotionalWorkspaceInputGrant
export type DevotionalOutputGrant = DevotionalWorkspaceOutputGrant

const INPUT_CONTENT_TYPE = {
  json: "application/json",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
} as const satisfies Record<DevotionalInputGrant["ext"], string>

const OUTPUT_FILE_NAME = {
  "devotional-output-portrait-v1": "portrait",
  "devotional-output-wide-v1": "wide",
} as const satisfies Record<DevotionalOutputGrant["artifactType"], string>

export class DevotionalTransferError extends WorkerError {
  constructor(message: string, retryable = false) {
    super(message, "devotional_transfer_invalid", retryable)
    this.name = "DevotionalTransferError"
  }
}

function attemptToken(attemptId: string): string {
  return createHash("sha256").update(attemptId).digest("hex").slice(0, 24)
}

function attemptRoot(attempt: DevotionalAttemptIdentity): string {
  return `runs/g${attempt.workspaceGeneration}/${attemptToken(attempt.attemptId)}`
}

function capabilityUrl(raw: string, production: boolean): URL {
  const url = new URL(raw)
  if (url.username || url.password || url.hash) {
    throw new DevotionalTransferError("signed Workspace URL is malformed")
  }
  if (production && url.protocol !== "https:") {
    throw new DevotionalTransferError("signed Workspace URL must use https")
  }
  if (!production && !["https:", "http:"].includes(url.protocol)) {
    throw new DevotionalTransferError("signed Workspace URL scheme is invalid")
  }
  const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase()
  if (production) {
    const ipVersion = isIP(hostname)
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      // Capability origins are configured as trusted DNS names. Rejecting all
      // IP literals also closes alternate/IPv4-mapped private-address forms.
      ipVersion !== 0
    ) {
      throw new DevotionalTransferError("signed Workspace URL host is private")
    }
  }
  return url
}

function targetsWorkspaceKey(url: URL, key: string): boolean {
  try {
    return decodeURIComponent(url.pathname).endsWith(`/${key}`)
  } catch {
    return false
  }
}

function sameAttempt(
  left: DevotionalAttemptIdentity,
  right: DevotionalAttemptIdentity,
): boolean {
  return (
    left.workspaceGeneration === right.workspaceGeneration &&
    left.attemptId === right.attemptId &&
    left.runId === right.runId
  )
}

function validInputGrant(
  input: DevotionalInputGrant,
  attempt: DevotionalAttemptIdentity,
  keyPattern: RegExp,
): boolean {
  const key = keyPattern.exec(input.ref.key)
  return (
    sameAttempt(input.ref.attempt, attempt) &&
    key?.[1] === input.ref.digest &&
    input.ref.key.endsWith(`.${input.ext}`) &&
    input.ref.contentType === INPUT_CONTENT_TYPE[input.ext]
  )
}

function outputUploadId(
  output: DevotionalOutputGrant,
  keyPattern: RegExp,
): string | null {
  const match = keyPattern.exec(output.key)
  return match?.[2] === OUTPUT_FILE_NAME[output.artifactType]
    ? (match[1] ?? null)
    : null
}

export function validateDevotionalWorkspaceTransfer(
  transfer: DevotionalWorkspaceTransfer,
  options: { nodeEnv: string; allowedOrigin?: string; now?: Date },
): void {
  const production = options.nodeEnv === "production"
  const now = options.now ?? new Date()
  const urls = [
    transfer.manifest.url,
    ...transfer.inputs.map(({ url }) => url),
    ...transfer.outputs.map(({ url }) => url),
  ].map((url) => capabilityUrl(url, production))
  const origin = urls[0]?.origin
  if (!origin || urls.some((url) => url.origin !== origin)) {
    throw new DevotionalTransferError(
      "signed Workspace URLs must share one storage origin",
    )
  }
  if (
    production &&
    (!options.allowedOrigin || origin !== options.allowedOrigin)
  ) {
    throw new DevotionalTransferError(
      "signed Workspace URL origin is not allowlisted",
    )
  }
  const keys = [
    transfer.manifest.ref.key,
    ...transfer.inputs.map(({ ref }) => ref.key),
    ...transfer.outputs.map(({ key }) => key),
  ]
  if (urls.some((url, index) => !targetsWorkspaceKey(url, keys[index] ?? ""))) {
    throw new DevotionalTransferError(
      "signed Workspace URL does not target its declared key",
    )
  }
  const expiresAt = [
    transfer.manifest.expiresAt,
    ...transfer.inputs.map(({ expiresAt }) => expiresAt),
    ...transfer.outputs.map(({ expiresAt }) => expiresAt),
  ]
  const expiryTimes = expiresAt.map((value) => Date.parse(value))
  if (expiryTimes.some((value) => value <= now.getTime())) {
    throw new DevotionalTransferError("signed Workspace URL has expired")
  }
  if (
    expiryTimes.some(
      (value) => value > now.getTime() + MAX_CAPABILITY_LIFETIME_MS,
    )
  ) {
    throw new DevotionalTransferError(
      "signed Workspace URL lifetime is too long",
    )
  }
  const root = attemptRoot(transfer.attempt)
  const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const inputKeyPattern = new RegExp(
    `^${escapedRoot}/run-input/([a-f0-9]{64})/[a-zA-Z0-9._-]+$`,
  )
  if (
    !sameAttempt(transfer.manifest.ref.attempt, transfer.attempt) ||
    transfer.manifest.ref.key !== `${root}/run-input/manifest.json` ||
    transfer.inputs.some(
      (input) => !validInputGrant(input, transfer.attempt, inputKeyPattern),
    ) ||
    transfer.manifest.ref.contentType !== "application/json"
  ) {
    throw new DevotionalTransferError(
      "signed Workspace input belongs to another attempt",
    )
  }
  if (
    new Set(
      transfer.inputs.map(({ artifactType, ext }) => `${artifactType}.${ext}`),
    ).size !== transfer.inputs.length
  ) {
    throw new DevotionalTransferError(
      "signed Workspace inputs contain duplicate artifact identities",
    )
  }
  const outputKeyPattern = new RegExp(
    `^${escapedRoot}/worker-upload/([a-zA-Z0-9_-]+)/(portrait|wide)\\.mp4$`,
  )
  const outputUploadIds = transfer.outputs.map((output) =>
    outputUploadId(output, outputKeyPattern),
  )
  if (
    outputUploadIds.some((uploadId) => uploadId == null) ||
    new Set(outputUploadIds).size !== 1
  ) {
    throw new DevotionalTransferError(
      "signed Workspace output is outside the attempt upload prefix",
    )
  }
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(TRANSFER_TIMEOUT_MS)
  return signal ? AbortSignal.any([timeout, signal]) : timeout
}

async function grantedResponse(options: {
  grant: DevotionalReadGrant
  maxBytes: number
  fetchImpl: typeof fetch
  signal?: AbortSignal
  nodeEnv: string
}): Promise<Response> {
  if (Date.parse(options.grant.expiresAt) <= Date.now()) {
    throw new DevotionalTransferError("signed Workspace URL has expired")
  }
  const url = capabilityUrl(options.grant.url, options.nodeEnv === "production")
  const response = await options.fetchImpl(url, {
    method: "GET",
    redirect: "error",
    signal: requestSignal(options.signal),
  })
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined)
    throw new DevotionalTransferError(
      `Workspace input download failed with HTTP ${response.status}`,
      response.status >= 500 || response.status === 429,
    )
  }
  const responseContentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase()
  if (
    responseContentType &&
    responseContentType !== options.grant.ref.contentType.toLowerCase()
  ) {
    await response.body.cancel().catch(() => undefined)
    throw new DevotionalTransferError(
      "Workspace input content type does not match its grant",
    )
  }
  const declared = Number(response.headers.get("content-length"))
  if (
    (Number.isFinite(declared) && declared > options.maxBytes) ||
    options.grant.ref.size > options.maxBytes
  ) {
    await response.body.cancel().catch(() => undefined)
    throw new DevotionalTransferError("Workspace input exceeds its byte cap")
  }
  return response
}

async function responseBytes(options: {
  grant: DevotionalReadGrant
  maxBytes: number
  fetchImpl: typeof fetch
  signal?: AbortSignal
  nodeEnv: string
}): Promise<Buffer> {
  const response = await grantedResponse(options)
  const chunks: Buffer[] = []
  let size = 0
  const hash = createHash("sha256")
  for await (const chunk of Readable.fromWeb(
    response.body as Parameters<typeof Readable.fromWeb>[0],
  )) {
    const body = Buffer.from(chunk as Uint8Array)
    size += body.byteLength
    if (size > options.maxBytes) {
      throw new DevotionalTransferError("Workspace input exceeds its byte cap")
    }
    hash.update(body)
    chunks.push(body)
  }
  if (
    size !== options.grant.ref.size ||
    hash.digest("hex") !== options.grant.ref.digest
  ) {
    throw new DevotionalTransferError(
      "Workspace input size or digest does not match its grant",
    )
  }
  return Buffer.concat(chunks)
}

export async function readDevotionalWorkspaceGrant(options: {
  grant: DevotionalReadGrant
  maxBytes: number
  fetchImpl: typeof fetch
  signal?: AbortSignal
  nodeEnv: string
}): Promise<Buffer> {
  return responseBytes(options)
}

export async function downloadDevotionalWorkspaceGrant(options: {
  grant: DevotionalReadGrant
  filePath: string
  maxBytes: number
  fetchImpl: typeof fetch
  signal?: AbortSignal
  nodeEnv: string
}): Promise<void> {
  const response = await grantedResponse(options)
  const stream = createWriteStream(options.filePath, { flags: "wx" })
  const hash = createHash("sha256")
  let size = 0
  try {
    for await (const chunk of Readable.fromWeb(
      response.body as Parameters<typeof Readable.fromWeb>[0],
    )) {
      const body = Buffer.from(chunk as Uint8Array)
      size += body.byteLength
      if (size > options.maxBytes) {
        throw new DevotionalTransferError(
          "Workspace input exceeds its byte cap",
        )
      }
      hash.update(body)
      if (!stream.write(body)) await once(stream, "drain")
    }
    if (
      size !== options.grant.ref.size ||
      hash.digest("hex") !== options.grant.ref.digest
    ) {
      throw new DevotionalTransferError(
        "Workspace input size or digest does not match its grant",
      )
    }
    stream.end()
    await once(stream, "finish")
  } catch (error) {
    stream.destroy()
    await response.body?.cancel().catch(() => undefined)
    await rm(options.filePath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function uploadDevotionalWorkspaceGrant(options: {
  grant: DevotionalOutputGrant
  attempt: DevotionalAttemptIdentity
  assetId: string
  filePath: string
  fetchImpl: typeof fetch
  signal?: AbortSignal
  nodeEnv: string
}): Promise<
  DevotionalWorkspaceRef & {
    assetId: string
    artifactType: DevotionalOutputGrant["artifactType"]
    ext: "mp4"
  }
> {
  if (Date.parse(options.grant.expiresAt) <= Date.now()) {
    throw new DevotionalTransferError("signed Workspace URL has expired")
  }
  const url = capabilityUrl(options.grant.url, options.nodeEnv === "production")
  const file = await stat(options.filePath)
  if (!file.isFile() || file.size <= 0) {
    throw new DevotionalTransferError("Workspace output file is invalid")
  }
  const hash = createHash("sha256")
  let streamedSize = 0
  const source = createReadStream(options.filePath)
  const hashingStream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      streamedSize += chunk.byteLength
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  source.pipe(hashingStream)
  const body = Readable.toWeb(hashingStream)
  const init = {
    method: "PUT",
    headers: {
      "content-type": options.grant.contentType,
      "content-length": String(file.size),
    },
    body: body as unknown as RequestInit["body"],
    redirect: "error",
    signal: requestSignal(options.signal),
    duplex: "half",
  } satisfies RequestInit & { duplex: "half" }
  let response: Response
  try {
    response = await options.fetchImpl(url, init as RequestInit)
  } catch (error) {
    source.destroy()
    hashingStream.destroy()
    throw error
  }
  if (!response.ok) {
    source.destroy()
    hashingStream.destroy()
    await response.body?.cancel().catch(() => undefined)
    throw new DevotionalTransferError(
      `Workspace output upload failed with HTTP ${response.status}`,
      response.status >= 500 || response.status === 429,
    )
  }
  await response.body?.cancel().catch(() => undefined)
  if (!hashingStream.readableEnded) await once(hashingStream, "end")
  if (streamedSize !== file.size) {
    throw new DevotionalTransferError(
      "Workspace output changed while it was uploaded",
    )
  }
  return {
    assetId: options.assetId,
    artifactType: options.grant.artifactType,
    ext: "mp4",
    schemaVersion: "2",
    key: options.grant.key,
    digest: hash.digest("hex"),
    size: streamedSize,
    contentType: "video/mp4",
    attempt: options.attempt,
  }
}
