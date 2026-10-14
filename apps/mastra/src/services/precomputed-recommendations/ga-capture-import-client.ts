import { z } from "zod"

import {
  MAX_GA_CAPTURE_ARTIFACT_BYTES,
  gaCaptureCanonicalJson,
  gaCaptureDigest,
} from "./ga-watch-capture-artifact"
import type { SourceIngest } from "./source-generation"

const id = z
  .string()
  .min(1)
  .max(191)
  .refine((value) => value === value.trim())
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const count = z.number().int().nonnegative().safe()
const version = z.literal("ga_capture_import_v1")

export const gaImportDestinationSchema = z
  .object({
    generationId: id,
    generationInputDigest: digest,
    sourceSetDigest: digest,
    inputCutoff: z.string().datetime(),
    selectedCorpusDigest: digest,
    candidatePoolDigest: digest,
    routeMappingDigest: digest,
    sourcePatternTableDigest: digest,
    querySpecDigest: digest,
    propertyId: z.literal("320198532"),
    propertyTimeZone: z.literal("America/New_York"),
    qualificationPolicy: z.literal("referrer_navigation_v1"),
    requestedStart: z.iso.date(),
    requestedEnd: z.iso.date(),
    usableStart: z.iso.date(),
    usableEnd: z.iso.date(),
    requestedCoverageDigest: digest,
    usableCoverageDigest: digest,
  })
  .strict()
const copySchema = z
  .object({
    artifactSha256: digest,
    artifactBytes: count.positive().max(MAX_GA_CAPTURE_ARTIFACT_BYTES),
    headerSha256: digest,
  })
  .strict()
export const gaImportOriginSchema = gaImportDestinationSchema
  .omit({
    qualificationPolicy: true,
  })
  .extend({
    baseQualificationDigest: digest,
    ...copySchema.shape,
    physicalHttpAttempts: count,
    physicalSucceededCalls: count,
  })
export const gaImportBindingSchema = z
  .object({
    version,
    destination: gaImportDestinationSchema,
    origin: gaImportOriginSchema,
    copy: copySchema,
    bindingDigest: digest,
  })
  .strict()
export type GaImportDestination = z.output<typeof gaImportDestinationSchema>
export type GaImportOrigin = z.output<typeof gaImportOriginSchema>
export type GaImportBinding = z.output<typeof gaImportBindingSchema>

const probeReply = z
  .object({ version, origin: gaImportOriginSchema, originProofDigest: digest })
  .strict()
const prepareReply = z
  .object({
    version,
    state: z.literal("prepared"),
    preparedDigest: digest,
    destination: gaImportDestinationSchema,
    replay: z.boolean(),
  })
  .strict()
const copyingStatus = z
  .object({
    version,
    state: z.literal("copying"),
    preparedDigest: digest,
    stagingDeadlineAt: z.string().datetime(),
  })
  .strict()
const boundStatus = z
  .object({
    version,
    state: z.literal("bound"),
    preparedDigest: digest,
    importBinding: gaImportBindingSchema,
    qualificationDigest: digest,
  })
  .strict()
const statusReply = z.discriminatedUnion("state", [
  z.object({ version, state: z.literal("absent") }).strict(),
  z
    .object({ version, state: z.literal("prepared"), preparedDigest: digest })
    .strict(),
  copyingStatus,
  boundStatus,
  z
    .object({
      version,
      state: z.literal("abandoned"),
      preparedDigest: digest,
      stagingDeadlineAt: z.string().datetime().optional(),
    })
    .strict(),
])
const copyReply = z.discriminatedUnion("state", [
  copyingStatus.extend({ replay: z.literal(true) }),
  boundStatus.extend({ replay: z.boolean() }),
])

export class GaCaptureImportError extends Error {
  constructor(
    readonly code:
      | "ga_import_invalid_request"
      | "ga_import_invalid_response"
      | "ga_import_identity_mismatch"
      | "ga_import_artifact_mismatch",
  ) {
    super(code)
  }
}

function fitsJson(value: unknown, maximum: number): boolean {
  try {
    const json = JSON.stringify(value)
    return json !== undefined && Buffer.byteLength(json, "utf8") <= maximum
  } catch {
    return false
  }
}
function same(left: unknown, right: unknown): boolean {
  return gaCaptureCanonicalJson(left) === gaCaptureCanonicalJson(right)
}
export function gaImportPreparedDigest(
  destination: GaImportDestination,
): string {
  return gaCaptureDigest({
    version: "ga_capture_import_prepare_v1",
    destination,
  })
}
function expectedDestination(value: GaImportDestination): GaImportDestination {
  const parsed = gaImportDestinationSchema.safeParse(value)
  if (
    !parsed.success ||
    parsed.data.requestedStart > parsed.data.usableStart ||
    parsed.data.usableStart > parsed.data.usableEnd ||
    parsed.data.usableEnd !== parsed.data.requestedEnd ||
    parsed.data.requestedEnd > parsed.data.inputCutoff.slice(0, 10)
  )
    throw new GaCaptureImportError("ga_import_invalid_request")
  return parsed.data
}
const compatibilityKeys = [
  "sourceSetDigest",
  "inputCutoff",
  "selectedCorpusDigest",
  "routeMappingDigest",
  "sourcePatternTableDigest",
  "querySpecDigest",
  "propertyId",
  "propertyTimeZone",
  "requestedStart",
  "requestedEnd",
  "usableStart",
  "usableEnd",
  "requestedCoverageDigest",
  "usableCoverageDigest",
] as const
function assertCompatible(
  destination: GaImportDestination,
  origin: GaImportOrigin,
): void {
  if (
    origin.generationId === destination.generationId ||
    origin.physicalSucceededCalls > origin.physicalHttpAttempts ||
    compatibilityKeys.some((key) => destination[key] !== origin[key])
  )
    throw new GaCaptureImportError("ga_import_identity_mismatch")
}

/** Neither an origin pool nor its generation identity is rewritten for reuse. */
export function validateGaImportBinding(
  raw: unknown,
  expected: GaImportDestination,
): GaImportBinding {
  const parsed = gaImportBindingSchema.safeParse(raw)
  if (!parsed.success || !fitsJson(parsed.data, 4_096))
    throw new GaCaptureImportError("ga_import_invalid_response")
  const value = parsed.data
  const { bindingDigest, ...identity } = value
  if (
    !same(value.destination, expectedDestination(expected)) ||
    gaCaptureDigest(identity) !== bindingDigest ||
    value.copy.artifactSha256 !== value.origin.artifactSha256 ||
    value.copy.artifactBytes !== value.origin.artifactBytes ||
    value.copy.headerSha256 !== value.origin.headerSha256
  )
    throw new GaCaptureImportError("ga_import_identity_mismatch")
  assertCompatible(value.destination, value.origin)
  return value
}

/** Uses the existing private ingest transport; never retries an import mutation. */
export function createGaCaptureImportClient(ingest: SourceIngest) {
  async function request<T>(schema: z.ZodType<T>, input: unknown): Promise<T> {
    if (!fitsJson(input, 65_536))
      throw new GaCaptureImportError("ga_import_invalid_request")
    const raw = await ingest(input)
    if (!fitsJson(raw, 32_768))
      throw new GaCaptureImportError("ga_import_invalid_response")
    const parsed = schema.safeParse(raw)
    if (!parsed.success)
      throw new GaCaptureImportError("ga_import_invalid_response")
    return parsed.data
  }
  function checkState<
    T extends z.output<typeof statusReply> | z.output<typeof copyReply>,
  >(state: T, destination: GaImportDestination): T {
    if (
      state.state !== "absent" &&
      state.preparedDigest !== gaImportPreparedDigest(destination)
    )
      throw new GaCaptureImportError("ga_import_identity_mismatch")
    if (state.state === "bound")
      validateGaImportBinding(state.importBinding, destination)
    return state
  }
  return {
    async probeOrigin(input: { originGenerationId: string }) {
      if (!id.safeParse(input.originGenerationId).success)
        throw new GaCaptureImportError("ga_import_invalid_request")
      const reply = await request(probeReply, {
        action: "ga_import_origin_probe_v1",
        originGenerationId: input.originGenerationId,
      })
      if (
        reply.origin.generationId !== input.originGenerationId ||
        reply.origin.physicalSucceededCalls > reply.origin.physicalHttpAttempts
      )
        throw new GaCaptureImportError("ga_import_identity_mismatch")
      return reply
    },
    async prepare(input: {
      destination: GaImportDestination
      attemptId: string
    }) {
      const destination = expectedDestination(input.destination)
      const reply = await request(prepareReply, {
        action: "ga_import_prepare_v1",
        generationId: destination.generationId,
        generationInputDigest: destination.generationInputDigest,
        attemptId: input.attemptId,
        candidatePoolDigest: destination.candidatePoolDigest,
        requestedStart: destination.requestedStart,
        requestedEnd: destination.requestedEnd,
        usableStart: destination.usableStart,
        usableEnd: destination.usableEnd,
        requestedCoverageDigest: destination.requestedCoverageDigest,
        usableCoverageDigest: destination.usableCoverageDigest,
      })
      if (
        !same(reply.destination, destination) ||
        reply.preparedDigest !== gaImportPreparedDigest(destination)
      )
        throw new GaCaptureImportError("ga_import_identity_mismatch")
      return reply
    },
    async copyBind(input: {
      destination: GaImportDestination
      attemptId: string
      origin: GaImportOrigin
      originProofDigest: string
    }) {
      const destination = expectedDestination(input.destination)
      const origin = gaImportOriginSchema.safeParse(input.origin)
      if (!origin.success || !digest.safeParse(input.originProofDigest).success)
        throw new GaCaptureImportError("ga_import_invalid_request")
      assertCompatible(destination, origin.data)
      const reply = checkState(
        await request(copyReply, {
          action: "ga_import_copy_bind_v1",
          generationId: destination.generationId,
          generationInputDigest: destination.generationInputDigest,
          attemptId: input.attemptId,
          preparedDigest: gaImportPreparedDigest(destination),
          originGenerationId: origin.data.generationId,
          originArtifactSha256: origin.data.artifactSha256,
          originProofDigest: input.originProofDigest,
        }),
        destination,
      )
      if (
        reply.state === "bound" &&
        !same(reply.importBinding.origin, origin.data)
      )
        throw new GaCaptureImportError("ga_import_identity_mismatch")
      return reply
    },
    async status(input: { destination: GaImportDestination }) {
      const destination = expectedDestination(input.destination)
      return checkState(
        await request(statusReply, {
          action: "ga_import_status_v1",
          generationId: destination.generationId,
          generationInputDigest: destination.generationInputDigest,
        }),
        destination,
      )
    },
  }
}
