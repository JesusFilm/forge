/**
 * Canonical, app-independent contracts for the Devotional Workspace data
 * plane. Mastra owns the Workspace and durable credentials. Media executors
 * consume only these bounded artifact identities and temporary capabilities.
 */
import { z } from "zod"

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_ID = /^[a-zA-Z0-9_-]+$/
const MAX_CAPABILITY_URL_LENGTH = 8_192

export const devotionalAttemptIdentitySchema = z
  .object({
    workspaceGeneration: z.number().int().positive(),
    attemptId: z.string().regex(SAFE_ID).max(128),
    runId: z.string().regex(SAFE_ID).max(128),
  })
  .strict()

export const devotionalWorkspaceArtifactRefSchema = z
  .object({
    schemaVersion: z.literal("2"),
    key: z.string().min(1).max(1024),
    digest: z.string().regex(SHA256),
    size: z.number().int().positive(),
    contentType: z.string().min(1).max(128),
    etag: z.string().min(1).max(256).optional(),
    attempt: devotionalAttemptIdentitySchema,
  })
  .strict()

export const devotionalWorkspaceManifestSchema = z
  .object({
    schemaVersion: z.literal("2"),
    kind: z.enum(["run-input", "attempt-output"]),
    attempt: devotionalAttemptIdentitySchema,
    artifacts: z
      .array(
        z
          .object({
            artifactType: z.string().regex(SAFE_ID),
            ext: z.string().regex(SAFE_ID),
            ref: devotionalWorkspaceArtifactRefSchema,
          })
          .strict(),
      )
      .min(1),
    selectedSources: z
      .array(
        z
          .object({
            path: z.string().startsWith("/inputs/"),
            category: z.string().min(1).max(128),
            digest: z.string().regex(SHA256),
            size: z.number().int().nonnegative(),
            modifiedAt: z.string().datetime(),
            etag: z.string().optional(),
            title: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(500)
      .optional(),
  })
  .strict()

export const devotionalWorkspaceReadGrantSchema = z
  .object({
    ref: devotionalWorkspaceArtifactRefSchema,
    url: z.string().url().max(MAX_CAPABILITY_URL_LENGTH),
    expiresAt: z.string().datetime(),
  })
  .strict()

export const devotionalWorkspaceInputGrantSchema =
  devotionalWorkspaceReadGrantSchema
    .extend({
      artifactType: z.string().regex(SAFE_ID).max(128),
      ext: z.enum(["json", "mp3", "mp4"]),
    })
    .strict()

export const devotionalWorkspaceOutputGrantSchema = z
  .object({
    artifactType: z.enum([
      "devotional-output-portrait-v1",
      "devotional-output-wide-v1",
    ]),
    ext: z.literal("mp4"),
    key: z.string().min(1).max(1024),
    contentType: z.literal("video/mp4"),
    url: z.string().url().max(MAX_CAPABILITY_URL_LENGTH),
    expiresAt: z.string().datetime(),
  })
  .strict()

export const devotionalWorkspaceTransferSchema = z
  .object({
    schemaVersion: z.literal("1"),
    attempt: devotionalAttemptIdentitySchema,
    manifest: devotionalWorkspaceReadGrantSchema,
    inputs: z.array(devotionalWorkspaceInputGrantSchema).min(2).max(40),
    outputs: z
      .array(devotionalWorkspaceOutputGrantSchema)
      .length(2)
      .refine(
        (outputs) =>
          new Set(outputs.map(({ artifactType }) => artifactType)).size === 2,
        "portrait and wide output grants are required",
      ),
  })
  .strict()

export type DevotionalWorkspaceArtifactRef = z.infer<
  typeof devotionalWorkspaceArtifactRefSchema
>
export type DevotionalAttemptIdentity = z.infer<
  typeof devotionalAttemptIdentitySchema
>
export type DevotionalWorkspaceManifest = z.infer<
  typeof devotionalWorkspaceManifestSchema
>
export type DevotionalWorkspaceReadGrant = z.infer<
  typeof devotionalWorkspaceReadGrantSchema
>
export type DevotionalWorkspaceInputGrant = z.infer<
  typeof devotionalWorkspaceInputGrantSchema
>
export type DevotionalWorkspaceOutputGrant = z.infer<
  typeof devotionalWorkspaceOutputGrantSchema
>
export type DevotionalWorkspaceTransfer = z.infer<
  typeof devotionalWorkspaceTransferSchema
>
