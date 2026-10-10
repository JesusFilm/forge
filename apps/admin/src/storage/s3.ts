// Storage service — Railway S3-compatible Object Storage with local tmp fallback.
//
// Mirrors apps/manager/src/services/storage.ts:
//   - Lazy `_s3` singleton
//   - `SAFE_KEY_PATTERN` validation
//   - Structured JSON logging
//   - Local fallback when RAILWAY_S3_BUCKET is not set
//
// Per Unit 11 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { env } from "@/config/env"

const useS3 = Boolean(env.RAILWAY_S3_BUCKET)

/**
 * In production, RAILWAY_S3_BUCKET absence is a fatal misconfiguration —
 * the local fallback would silently read from an ephemeral container's
 * `.tmp/objects/...` which doesn't exist, and downstream consumers would
 * misclassify the resulting ENOENT as "object not uploaded yet". Fail
 * loudly here so the operator sees a specific configuration error.
 */
function assertStorageConfiguredForProduction(): void {
  if (!useS3 && env.NODE_ENV === "production") {
    throw new Error(
      "RAILWAY_S3_BUCKET is not set — admin storage cannot use local fallback in production",
    )
  }
}

export type WriteArtifactOptions = {
  assetId: string
  artifactType: string
  ext: string
  body: Buffer | Uint8Array | string
  contentType?: string
}

const SAFE_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/

// Object-key pattern for arbitrary S3 keys (e.g. admin-migrations/core-id-mapping.json).
// Each segment must contain at least one non-dot character, which rules out bare
// `..` and `.` segments (traversal / cwd-ref shapes) at the regex layer. Leading
// and trailing slashes are not allowed.
const SAFE_OBJECT_KEY_PATTERN =
  /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*(\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*)*$/

function validateKeyComponent(value: string, name: string): void {
  if (!SAFE_KEY_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${name}: must contain only alphanumeric characters, hyphens, and underscores`,
    )
  }
}

function validateObjectKey(key: string): void {
  if (!SAFE_OBJECT_KEY_PATTERN.test(key)) {
    throw new Error(
      `Invalid object key: must be slash-separated segments of letters, digits, '.', '-', '_' with each segment starting with a non-dot character`,
    )
  }
}

function artifactKey(
  assetId: string,
  artifactType: string,
  ext: string,
): string {
  validateKeyComponent(assetId, "assetId")
  validateKeyComponent(ext, "ext")
  if (!/^[a-zA-Z0-9_-]+$/.test(artifactType)) {
    throw new Error("Invalid artifactType")
  }
  return `${assetId}/${artifactType}.${ext}`
}

// ---------------------------------------------------------------------------
// S3 backend
// ---------------------------------------------------------------------------

let _s3: InstanceType<typeof import("@aws-sdk/client-s3").S3Client> | undefined

async function getS3() {
  if (!_s3) {
    if (!env.RAILWAY_S3_ACCESS_KEY_ID || !env.RAILWAY_S3_SECRET_ACCESS_KEY) {
      throw new Error(
        "RAILWAY_S3_ACCESS_KEY_ID and RAILWAY_S3_SECRET_ACCESS_KEY are required when RAILWAY_S3_BUCKET is set",
      )
    }
    const [{ S3Client }, { NodeHttpHandler }] = await Promise.all([
      import("@aws-sdk/client-s3"),
      import("@smithy/node-http-handler"),
    ])
    if (!_s3) {
      _s3 = new S3Client({
        endpoint: env.RAILWAY_S3_ENDPOINT,
        region: env.RAILWAY_S3_REGION ?? "auto",
        credentials: {
          accessKeyId: env.RAILWAY_S3_ACCESS_KEY_ID,
          secretAccessKey: env.RAILWAY_S3_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
        // Bound every request so a stalled Railway S3 endpoint doesn't hold
        // the workflow runtime hostage. Defaults are "no timeout", which
        // means stepLoadMapping can wait minutes on a TCP half-open.
        requestHandler: new NodeHttpHandler({
          connectionTimeout: 5_000,
          requestTimeout: 30_000,
        }),
      })
    }
  }
  return _s3
}

// ---------------------------------------------------------------------------
// Local fallback
// ---------------------------------------------------------------------------

const LOCAL_DIR = join(process.cwd(), ".tmp", "artifacts")
const LOCAL_OBJECT_DIR = join(process.cwd(), ".tmp", "objects")

async function localWrite(options: WriteArtifactOptions): Promise<string> {
  const key = artifactKey(options.assetId, options.artifactType, options.ext)
  const dir = join(LOCAL_DIR, options.assetId)
  await mkdir(dir, { recursive: true })
  const filePath = join(LOCAL_DIR, key)
  await writeFile(filePath, options.body)
  return key
}

async function localRead(
  assetId: string,
  artifactType: string,
  ext: string,
): Promise<Uint8Array> {
  const key = artifactKey(assetId, artifactType, ext)
  return readFile(join(LOCAL_DIR, key))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function writeArtifact(
  options: WriteArtifactOptions,
): Promise<string> {
  if (!useS3) return localWrite(options)

  const { PutObjectCommand } = await import("@aws-sdk/client-s3")
  const key = artifactKey(options.assetId, options.artifactType, options.ext)
  const s3 = await getS3()

  await s3.send(
    new PutObjectCommand({
      Bucket: env.RAILWAY_S3_BUCKET,
      Key: key,
      Body: options.body,
      ContentType: options.contentType,
    }),
  )

  console.log(
    JSON.stringify({
      event: "storage.write",
      key,
      backend: "s3",
      service: "forge-admin",
    }),
  )
  return key
}

/**
 * Read a `{assetId}/{artifactType}.{ext}` artifact from admin's OWN
 * Railway S3 bucket (`RAILWAY_S3_*`).
 *
 * Today this has no production caller in admin — admin doesn't write
 * artifacts in this key shape; it only writes object-key resources
 * (admin-migrations/...) via {@link writeObject}. The function is
 * retained as the symmetric pair to {@link writeArtifact} for any
 * future intra-admin artifact use case.
 *
 * **Do NOT use this helper to read manager-produced artifacts** —
 * manager-produced artifacts live in manager's bucket, not admin's.
 * Use {@link readManagerArtifact} for those.
 */
export async function readArtifact(
  assetId: string,
  artifactType: string,
  ext: string,
): Promise<Uint8Array> {
  if (!useS3) return localRead(assetId, artifactType, ext)

  const { GetObjectCommand } = await import("@aws-sdk/client-s3")
  const key = artifactKey(assetId, artifactType, ext)
  const s3 = await getS3()

  const response = await s3.send(
    new GetObjectCommand({
      Bucket: env.RAILWAY_S3_BUCKET,
      Key: key,
    }),
  )

  if (!response.Body) throw new Error(`Empty body for ${key}`)
  return new Uint8Array(await response.Body.transformToByteArray())
}

// ---------------------------------------------------------------------------
// Manager artifacts S3 backend — read-only by design.
//
// Admin's transcript backfill reads `{assetId}/transcript.json` produced by
// apps/manager. Those artifacts live in manager's own
// Railway bucket, NOT admin's RAILWAY_S3_* (cms-storage) bucket — admin's
// reads must be routed there.
//
// Distinct env block (MANAGER_ARTIFACTS_S3_*) so admin's writes (which
// continue to land in RAILWAY_S3_BUCKET) never mix with manager's bucket.
// No writeManagerArtifact helper exists: read-only is enforced at the
// code layer because Railway's bucket resources don't expose a
// separate read-only credential.
// ---------------------------------------------------------------------------

const useManagerArtifactsS3 = Boolean(env.MANAGER_ARTIFACTS_S3_BUCKET)

function assertManagerArtifactsConfiguredForProduction(): void {
  if (!useManagerArtifactsS3 && env.NODE_ENV === "production") {
    throw new Error(
      "MANAGER_ARTIFACTS_S3_BUCKET is not set — admin cannot read manager artifacts via local fallback in production",
    )
  }
}

let _s3ManagerArtifacts:
  | InstanceType<typeof import("@aws-sdk/client-s3").S3Client>
  | undefined

async function getManagerArtifactsS3() {
  if (!_s3ManagerArtifacts) {
    if (
      !env.MANAGER_ARTIFACTS_S3_ACCESS_KEY_ID ||
      !env.MANAGER_ARTIFACTS_S3_SECRET_ACCESS_KEY
    ) {
      throw new Error(
        "MANAGER_ARTIFACTS_S3_ACCESS_KEY_ID and MANAGER_ARTIFACTS_S3_SECRET_ACCESS_KEY are required when MANAGER_ARTIFACTS_S3_BUCKET is set",
      )
    }
    const [{ S3Client }, { NodeHttpHandler }] = await Promise.all([
      import("@aws-sdk/client-s3"),
      import("@smithy/node-http-handler"),
    ])
    if (!_s3ManagerArtifacts) {
      _s3ManagerArtifacts = new S3Client({
        endpoint: env.MANAGER_ARTIFACTS_S3_ENDPOINT,
        region: env.MANAGER_ARTIFACTS_S3_REGION ?? "auto",
        credentials: {
          accessKeyId: env.MANAGER_ARTIFACTS_S3_ACCESS_KEY_ID,
          secretAccessKey: env.MANAGER_ARTIFACTS_S3_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
        // Same timeout discipline as the primary client — a stalled
        // manager-bucket endpoint must not hold the workflow runtime
        // hostage.
        requestHandler: new NodeHttpHandler({
          connectionTimeout: 5_000,
          requestTimeout: 30_000,
        }),
      })
    }
  }
  return _s3ManagerArtifacts
}

/**
 * Read a manager-produced artifact from manager's S3 bucket.
 *
 * Mirrors `readArtifact` but resolves bucket + creds from the
 * MANAGER_ARTIFACTS_S3_* env block. Falls back to the same local
 * `.tmp/artifacts/{assetId}/{artifactType}.{ext}` path as
 * `readArtifact` when MANAGER_ARTIFACTS_S3_BUCKET is unset (dev
 * convenience — both helpers point at the same on-disk fixtures).
 *
 * Production guard: if MANAGER_ARTIFACTS_S3_BUCKET is unset and
 * NODE_ENV === "production", throws — the local fallback would
 * silently miss every artifact and downstream consumers would
 * misclassify the resulting ENOENT as "manager hasn't produced this
 * yet."
 */
export async function readManagerArtifact(
  assetId: string,
  artifactType: string,
  ext: string,
): Promise<Uint8Array> {
  assertManagerArtifactsConfiguredForProduction()

  if (!useManagerArtifactsS3) return localRead(assetId, artifactType, ext)

  const { GetObjectCommand } = await import("@aws-sdk/client-s3")
  const key = artifactKey(assetId, artifactType, ext)
  const s3 = await getManagerArtifactsS3()

  const response = await s3.send(
    new GetObjectCommand({
      Bucket: env.MANAGER_ARTIFACTS_S3_BUCKET,
      Key: key,
    }),
  )

  if (!response.Body) throw new Error(`Empty body for ${key}`)
  return new Uint8Array(await response.Body.transformToByteArray())
}

/**
 * Cheap reachability probe for manager's artifact bucket. Used by
 * long-running operator CLIs before they start enumerating/indexing a
 * large corpus. This intentionally exposes only an ok/error boundary;
 * callers classify the thrown AWS/transport error for operator output.
 */
export async function assertManagerArtifactsReachable(): Promise<void> {
  assertManagerArtifactsConfiguredForProduction()

  if (!useManagerArtifactsS3) {
    // Local fallback is reachable if the process can read its cwd; the
    // real artifact read will report ENOENT for individual files.
    return
  }

  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3")
  const s3 = await getManagerArtifactsS3()
  await s3.send(
    new ListObjectsV2Command({
      Bucket: env.MANAGER_ARTIFACTS_S3_BUCKET,
      MaxKeys: 1,
    }),
  )
}

// ---------------------------------------------------------------------------
// Object-key API — reads/writes to an arbitrary S3 key (slash-separated
// path segments), rather than the `{assetId}/{artifactType}.{ext}` shape.
// Used for admin-scoped resources like the coreId mapping snapshot.
// ---------------------------------------------------------------------------

export async function writeObject(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType?: string,
): Promise<string> {
  validateObjectKey(key)
  assertStorageConfiguredForProduction()

  if (!useS3) {
    const filePath = join(LOCAL_OBJECT_DIR, key)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, body)
    return key
  }

  const { PutObjectCommand } = await import("@aws-sdk/client-s3")
  const s3 = await getS3()

  await s3.send(
    new PutObjectCommand({
      Bucket: env.RAILWAY_S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )

  console.log(
    JSON.stringify({
      event: "storage.write",
      key,
      backend: "s3",
      service: "forge-admin",
    }),
  )
  return key
}

export async function readObject(key: string): Promise<Uint8Array> {
  validateObjectKey(key)
  assertStorageConfiguredForProduction()

  if (!useS3) {
    return readFile(join(LOCAL_OBJECT_DIR, key))
  }

  const { GetObjectCommand } = await import("@aws-sdk/client-s3")
  const s3 = await getS3()

  const response = await s3.send(
    new GetObjectCommand({
      Bucket: env.RAILWAY_S3_BUCKET,
      Key: key,
    }),
  )

  if (!response.Body) throw new Error(`Empty body for ${key}`)
  return new Uint8Array(await response.Body.transformToByteArray())
}

/**
 * Cheap reachability probe for admin's own object bucket. Kept separate
 * from readObject so callers can distinguish "bucket/config/transport
 * broken" from "specific mapping object missing".
 */
export async function assertObjectStorageReachable(): Promise<void> {
  assertStorageConfiguredForProduction()

  if (!useS3) return

  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3")
  const s3 = await getS3()
  await s3.send(
    new ListObjectsV2Command({
      Bucket: env.RAILWAY_S3_BUCKET,
      MaxKeys: 1,
    }),
  )
}
