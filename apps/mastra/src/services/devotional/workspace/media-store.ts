import { createHash } from "node:crypto"

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import {
  devotionalAttemptIdentitySchema,
  devotionalWorkspaceArtifactRefSchema,
  devotionalWorkspaceManifestSchema,
  type DevotionalAttemptIdentity,
  type DevotionalWorkspaceArtifactRef,
  type DevotionalWorkspaceManifest,
} from "@forge/devotional-workspace"
import type { WorkspaceFilesystem } from "@mastra/core/workspace"

const SAFE_ID = /^[a-zA-Z0-9_-]+$/
const SHA256 = /^[a-f0-9]{64}$/
const SAFE_FILE_NAME = /^[a-zA-Z0-9._-]+$/
const SIGNED_TRANSFER_TTL_SECONDS = 85 * 60
const DEVOTIONAL_OUTPUT_ARTIFACT_TYPES = new Set([
  "devotional-output-portrait-v1",
  "devotional-output-wide-v1",
])

export type DevotionalWorkspaceMediaErrorCode =
  | "config_missing"
  | "integrity_failed"
  | "invalid_input"

export class DevotionalWorkspaceMediaError extends Error {
  constructor(
    readonly code: DevotionalWorkspaceMediaErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "DevotionalWorkspaceMediaError"
  }
}

export const DevotionalAttemptIdentitySchema = devotionalAttemptIdentitySchema
export const DevotionalWorkspaceArtifactRefSchema =
  devotionalWorkspaceArtifactRefSchema
export type { DevotionalAttemptIdentity, DevotionalWorkspaceArtifactRef }

export type DevotionalWorkspaceReadGrant = {
  ref: DevotionalWorkspaceArtifactRef
  url: string
  expiresAt: string
}

export type DevotionalWorkspaceUploadGrant = {
  key: string
  contentType: "video/mp4"
  url: string
  expiresAt: string
}

type S3ObjectSigning = {
  client: S3Client
  bucket: string
  prefix: string
}

type Presign = typeof getSignedUrl

export type DevotionalWorkspaceMediaStore = {
  supportsSignedTransfers: boolean
  writeImmutableArtifact(options: {
    key: string
    body: Uint8Array | string
    contentType: string
    attempt: DevotionalAttemptIdentity
  }): Promise<DevotionalWorkspaceArtifactRef>
  createReadGrant(
    ref: DevotionalWorkspaceArtifactRef,
  ): Promise<DevotionalWorkspaceReadGrant>
  createUploadGrant(options: {
    attempt: DevotionalAttemptIdentity
    uploadId: string
    fileName: "portrait.mp4" | "wide.mp4"
  }): Promise<DevotionalWorkspaceUploadGrant>
  finalizeUpload(options: {
    grant: DevotionalWorkspaceUploadGrant
    digest: string
    size: number
    attempt: DevotionalAttemptIdentity
    fileName: "portrait.mp4" | "wide.mp4"
  }): Promise<DevotionalWorkspaceArtifactRef>
  verifyArtifact(ref: DevotionalWorkspaceArtifactRef): Promise<void>
  readManifest(options: {
    workspaceGeneration: number
    attemptToken: string
    kind: "run-input" | "attempt-output"
    digest: string
    size: number
  }): Promise<Buffer>
  readAttemptOutput(attempt: DevotionalAttemptIdentity): Promise<{
    manifestRef: DevotionalWorkspaceArtifactRef
    manifest: DevotionalWorkspaceManifest
  } | null>
  discardUpload(grant: DevotionalWorkspaceUploadGrant): Promise<void>
  fetchArtifact(
    ref: DevotionalWorkspaceArtifactRef,
    range?: string,
  ): Promise<Response>
}

function attemptToken(attemptId: string): string {
  if (!SAFE_ID.test(attemptId) || attemptId.length > 128) {
    throw new DevotionalWorkspaceMediaError(
      "invalid_input",
      "invalid devotional attempt id",
    )
  }
  return createHash("sha256").update(attemptId).digest("hex").slice(0, 24)
}

export function devotionalAttemptRoot(
  attempt: DevotionalAttemptIdentity,
): string {
  DevotionalAttemptIdentitySchema.parse(attempt)
  return `runs/g${attempt.workspaceGeneration}/${attemptToken(attempt.attemptId)}`
}

export function devotionalWorkspaceArtifactKey(options: {
  attempt: DevotionalAttemptIdentity
  area: "run-input" | "attempt-output"
  digest: string
  fileName: string
}): string {
  if (!SHA256.test(options.digest) || !SAFE_FILE_NAME.test(options.fileName)) {
    throw new DevotionalWorkspaceMediaError(
      "invalid_input",
      "invalid devotional Workspace artifact key",
    )
  }
  return `${devotionalAttemptRoot(options.attempt)}/${options.area}/${options.digest}/${options.fileName}`
}

export function devotionalWorkspaceManifestKey(options: {
  attempt: DevotionalAttemptIdentity
  area: "run-input" | "attempt-output"
}): string {
  return `${devotionalAttemptRoot(options.attempt)}/${options.area}/manifest.json`
}

function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/gu, "")
}

function objectKey(prefix: string, key: string): string {
  return [normalizePrefix(prefix), key].filter(Boolean).join("/")
}

export function devotionalWorkspaceObjectKey(
  prefix: string,
  workspacePath: string,
): string {
  return objectKey(prefix, workspacePath)
}

function bytes(value: Uint8Array | string): Buffer {
  return Buffer.from(value)
}

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function assertCanonicalArtifactRef(ref: DevotionalWorkspaceArtifactRef): void {
  const root = devotionalAttemptRoot(ref.attempt)
  if (
    ref.key === `${root}/run-input/manifest.json` ||
    ref.key === `${root}/attempt-output/manifest.json`
  ) {
    return
  }
  const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const match = new RegExp(
    `^${escapedRoot}/(?:run-input|attempt-output)/([a-f0-9]{64})/[a-zA-Z0-9._-]+$`,
  ).exec(ref.key)
  if (match?.[1] !== ref.digest) {
    throw new DevotionalWorkspaceMediaError(
      "invalid_input",
      "devotional Workspace artifact key is not canonical",
    )
  }
}

function assertGrantKey(options: {
  grant: DevotionalWorkspaceUploadGrant
  attempt: DevotionalAttemptIdentity
  fileName: string
}): void {
  const root = devotionalAttemptRoot(options.attempt)
  const pattern = new RegExp(
    `^${root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/worker-upload/[a-zA-Z0-9_-]+/${options.fileName.replace(".", "\\.")}$`,
  )
  if (!pattern.test(options.grant.key)) {
    throw new DevotionalWorkspaceMediaError(
      "invalid_input",
      "temporary upload key is outside the devotional attempt",
    )
  }
}

export function createDevotionalWorkspaceMediaStore(options: {
  filesystem: WorkspaceFilesystem
  digestReader?: (path: string) => Promise<string | undefined>
  s3?: S3ObjectSigning
  presign?: Presign
  fetchImpl?: typeof fetch
}): DevotionalWorkspaceMediaStore {
  const presign = options.presign ?? getSignedUrl
  const fetchImpl = options.fetchImpl ?? fetch

  const readS3Etag = async (
    ref: DevotionalWorkspaceArtifactRef,
  ): Promise<string | undefined> => {
    if (!options.s3) return undefined
    const metadata = await options.s3.client.send(
      new HeadObjectCommand({
        Bucket: options.s3.bucket,
        Key: objectKey(options.s3.prefix, ref.key),
      }),
    )
    if (
      metadata.ContentLength != null &&
      Number(metadata.ContentLength) !== ref.size
    ) {
      throw new DevotionalWorkspaceMediaError(
        "integrity_failed",
        `devotional Workspace artifact size changed: ${ref.key}`,
      )
    }
    if (!metadata.ETag) {
      throw new DevotionalWorkspaceMediaError(
        "integrity_failed",
        `devotional Workspace artifact has no ETag: ${ref.key}`,
      )
    }
    return metadata.ETag
  }

  const verifyStoredArtifact = async (
    ref: DevotionalWorkspaceArtifactRef,
  ): Promise<string | undefined> => {
    DevotionalWorkspaceArtifactRefSchema.parse(ref)
    const initialEtag = await readS3Etag(ref)
    if (ref.etag) {
      if (initialEtag !== ref.etag) {
        throw new DevotionalWorkspaceMediaError(
          "integrity_failed",
          `devotional Workspace artifact changed: ${ref.key}`,
        )
      }
      return initialEtag
    }
    const stat = await options.filesystem.stat(ref.key)
    if (stat.type !== "file" || stat.size !== ref.size) {
      throw new DevotionalWorkspaceMediaError(
        "integrity_failed",
        `devotional Workspace artifact size changed: ${ref.key}`,
      )
    }
    const actualDigest = options.digestReader
      ? await options.digestReader(ref.key)
      : await options.filesystem
          .readFile(ref.key)
          .then((value) =>
            digest(typeof value === "string" ? Buffer.from(value) : value),
          )
    if (actualDigest !== ref.digest) {
      throw new DevotionalWorkspaceMediaError(
        "integrity_failed",
        `devotional Workspace artifact digest changed: ${ref.key}`,
      )
    }
    const verifiedEtag = await readS3Etag(ref)
    if (initialEtag !== verifiedEtag) {
      throw new DevotionalWorkspaceMediaError(
        "integrity_failed",
        `devotional Workspace artifact changed: ${ref.key}`,
      )
    }
    return verifiedEtag
  }

  const verifyArtifact = async (
    ref: DevotionalWorkspaceArtifactRef,
  ): Promise<void> => {
    assertCanonicalArtifactRef(ref)
    await verifyStoredArtifact(ref)
  }

  const readManifest: DevotionalWorkspaceMediaStore["readManifest"] = async (
    input,
  ) => {
    if (
      !Number.isSafeInteger(input.workspaceGeneration) ||
      input.workspaceGeneration <= 0 ||
      !/^[a-f0-9]{24}$/u.test(input.attemptToken) ||
      !SHA256.test(input.digest) ||
      !Number.isSafeInteger(input.size) ||
      input.size <= 0
    ) {
      throw new DevotionalWorkspaceMediaError(
        "invalid_input",
        "devotional Workspace manifest locator is invalid",
      )
    }
    const key = `runs/g${input.workspaceGeneration}/${input.attemptToken}/${input.kind}/manifest.json`
    const value = await options.filesystem.readFile(key)
    const body = Buffer.from(value)
    if (body.byteLength !== input.size || digest(body) !== input.digest) {
      throw new DevotionalWorkspaceMediaError(
        "integrity_failed",
        `devotional Workspace artifact changed: ${key}`,
      )
    }
    return body
  }

  const readAttemptOutput: DevotionalWorkspaceMediaStore["readAttemptOutput"] =
    async (attempt) => {
      DevotionalAttemptIdentitySchema.parse(attempt)
      const key = devotionalWorkspaceManifestKey({
        attempt,
        area: "attempt-output",
      })
      if (!(await options.filesystem.exists(key))) return null
      const value = await options.filesystem.readFile(key)
      const body = Buffer.from(value)
      const parsed = devotionalWorkspaceManifestSchema.safeParse(
        JSON.parse(body.toString("utf8")),
      )
      if (
        !parsed.success ||
        parsed.data.kind !== "attempt-output" ||
        parsed.data.attempt.workspaceGeneration !==
          attempt.workspaceGeneration ||
        parsed.data.attempt.attemptId !== attempt.attemptId ||
        parsed.data.attempt.runId !== attempt.runId
      ) {
        throw new DevotionalWorkspaceMediaError(
          "integrity_failed",
          "devotional Workspace output manifest is invalid",
        )
      }
      const artifactTypes = new Set(
        parsed.data.artifacts.map(({ artifactType }) => artifactType),
      )
      if (
        parsed.data.artifacts.length !== 2 ||
        artifactTypes.size !== 2 ||
        [...artifactTypes].some(
          (artifactType) => !DEVOTIONAL_OUTPUT_ARTIFACT_TYPES.has(artifactType),
        ) ||
        parsed.data.artifacts.some(
          ({ ext, ref }) =>
            ext !== "mp4" ||
            ref.contentType !== "video/mp4" ||
            ref.attempt.workspaceGeneration !== attempt.workspaceGeneration ||
            ref.attempt.attemptId !== attempt.attemptId ||
            ref.attempt.runId !== attempt.runId,
        )
      ) {
        throw new DevotionalWorkspaceMediaError(
          "integrity_failed",
          "devotional Workspace output manifest is incomplete",
        )
      }
      await Promise.all(
        parsed.data.artifacts.map(({ ref }) => verifyArtifact(ref)),
      )
      return {
        manifestRef: {
          schemaVersion: "2",
          key,
          digest: digest(body),
          size: body.byteLength,
          contentType: "application/json",
          attempt,
        },
        manifest: parsed.data,
      }
    }

  return {
    supportsSignedTransfers: options.s3 != null,

    async writeImmutableArtifact(input) {
      DevotionalAttemptIdentitySchema.parse(input.attempt)
      const body = bytes(input.body)
      if (body.byteLength === 0) {
        throw new DevotionalWorkspaceMediaError(
          "invalid_input",
          "devotional Workspace artifacts cannot be empty",
        )
      }
      const ref: DevotionalWorkspaceArtifactRef = {
        schemaVersion: "2",
        key: input.key,
        digest: digest(body),
        size: body.byteLength,
        contentType: input.contentType,
        attempt: input.attempt,
      }
      assertCanonicalArtifactRef(ref)
      if (await options.filesystem.exists(input.key)) {
        await verifyArtifact(ref)
        return ref
      }
      try {
        await options.filesystem.writeFile(input.key, body, {
          recursive: true,
          overwrite: false,
          mimeType: input.contentType,
        })
      } catch (error) {
        if (!(await options.filesystem.exists(input.key))) throw error
      }
      await verifyArtifact(ref)
      return ref
    },

    async createReadGrant(ref) {
      DevotionalWorkspaceArtifactRefSchema.parse(ref)
      assertCanonicalArtifactRef(ref)
      if (!options.s3) {
        throw new DevotionalWorkspaceMediaError(
          "config_missing",
          "signed devotional Workspace transfers require S3",
        )
      }
      const expiresAt = new Date(
        Date.now() + SIGNED_TRANSFER_TTL_SECONDS * 1000,
      ).toISOString()
      return {
        ref,
        url: await presign(
          options.s3.client,
          new GetObjectCommand({
            Bucket: options.s3.bucket,
            Key: objectKey(options.s3.prefix, ref.key),
          }),
          { expiresIn: SIGNED_TRANSFER_TTL_SECONDS },
        ),
        expiresAt,
      }
    },

    async createUploadGrant(input) {
      DevotionalAttemptIdentitySchema.parse(input.attempt)
      if (!SAFE_ID.test(input.uploadId) || input.uploadId.length > 128) {
        throw new DevotionalWorkspaceMediaError(
          "invalid_input",
          "invalid devotional upload id",
        )
      }
      if (!options.s3) {
        throw new DevotionalWorkspaceMediaError(
          "config_missing",
          "signed devotional Workspace transfers require S3",
        )
      }
      const key = `${devotionalAttemptRoot(input.attempt)}/worker-upload/${input.uploadId}/${input.fileName}`
      const expiresAt = new Date(
        Date.now() + SIGNED_TRANSFER_TTL_SECONDS * 1000,
      ).toISOString()
      return {
        key,
        contentType: "video/mp4",
        url: await presign(
          options.s3.client,
          new PutObjectCommand({
            Bucket: options.s3.bucket,
            Key: objectKey(options.s3.prefix, key),
            ContentType: "video/mp4",
          }),
          { expiresIn: SIGNED_TRANSFER_TTL_SECONDS },
        ),
        expiresAt,
      }
    },

    async finalizeUpload(input) {
      if (!SHA256.test(input.digest) || !Number.isSafeInteger(input.size)) {
        throw new DevotionalWorkspaceMediaError(
          "invalid_input",
          "invalid devotional Worker upload identity",
        )
      }
      assertGrantKey(input)
      const temporaryRef: DevotionalWorkspaceArtifactRef = {
        schemaVersion: "2",
        key: input.grant.key,
        digest: input.digest,
        size: input.size,
        contentType: "video/mp4",
        attempt: input.attempt,
      }
      await verifyStoredArtifact(temporaryRef)
      const finalRef: DevotionalWorkspaceArtifactRef = {
        ...temporaryRef,
        key: devotionalWorkspaceArtifactKey({
          attempt: input.attempt,
          area: "attempt-output",
          digest: input.digest,
          fileName: input.fileName,
        }),
      }
      if (await options.filesystem.exists(finalRef.key)) {
        const etag = await verifyStoredArtifact(finalRef)
        await options.filesystem.deleteFile(temporaryRef.key)
        return { ...finalRef, ...(etag ? { etag } : {}) }
      }
      try {
        await options.filesystem.moveFile(temporaryRef.key, finalRef.key, {
          overwrite: false,
        })
      } catch (error) {
        if (!(await options.filesystem.exists(finalRef.key))) throw error
        const etag = await verifyStoredArtifact(finalRef)
        if (await options.filesystem.exists(temporaryRef.key)) {
          await options.filesystem.deleteFile(temporaryRef.key)
        }
        return { ...finalRef, ...(etag ? { etag } : {}) }
      }
      const etag = await verifyStoredArtifact(finalRef)
      return { ...finalRef, ...(etag ? { etag } : {}) }
    },

    verifyArtifact,
    readManifest,
    readAttemptOutput,

    async discardUpload(grant) {
      if (!/\/worker-upload\//u.test(grant.key)) {
        throw new DevotionalWorkspaceMediaError(
          "invalid_input",
          "temporary upload key is invalid",
        )
      }
      await options.filesystem.deleteFile(grant.key)
    },

    async fetchArtifact(ref, range) {
      DevotionalWorkspaceArtifactRefSchema.parse(ref)
      assertCanonicalArtifactRef(ref)
      if (!options.s3) {
        const value = await options.filesystem.readFile(ref.key)
        const body =
          typeof value === "string" ? Buffer.from(value) : Buffer.from(value)
        if (body.byteLength !== ref.size || digest(body) !== ref.digest) {
          throw new DevotionalWorkspaceMediaError(
            "integrity_failed",
            `devotional Workspace artifact changed: ${ref.key}`,
          )
        }
        return new Response(new Uint8Array(body), {
          status: 200,
          headers: {
            "content-type": ref.contentType,
            "content-length": String(ref.size),
          },
        })
      }
      const etag = await verifyStoredArtifact(ref)
      if (!etag) {
        throw new DevotionalWorkspaceMediaError(
          "integrity_failed",
          "devotional Workspace artifact has no ETag",
        )
      }
      const url = await presign(
        options.s3.client,
        new GetObjectCommand({
          Bucket: options.s3.bucket,
          Key: objectKey(options.s3.prefix, ref.key),
          IfMatch: etag,
          ...(range ? { Range: range } : {}),
        }),
        { expiresIn: 5 * 60 },
      )
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          "if-match": etag,
          ...(range ? { range } : {}),
        },
        redirect: "error",
        signal: AbortSignal.timeout(20 * 60_000),
      })
      if (response.status === 412) {
        await response.body?.cancel().catch(() => undefined)
        throw new DevotionalWorkspaceMediaError(
          "integrity_failed",
          `devotional Workspace artifact changed: ${ref.key}`,
        )
      }
      return response
    },
  }
}
