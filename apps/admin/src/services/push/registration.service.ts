/**
 * R1 to R5, R14 and R29 — one phone registers, refreshes, and reports that its
 * permission is gone.
 *
 * The push token is the identity of the row, so every call is an upsert on it.
 * KTD4 owns the status rules: invalid is terminal, a revoked grant is
 * inactive, and a viewer's newer token supersedes their older one.
 *
 * SECURITY: no log line here carries the push token, a viewer handle, or a
 * digest. The registration log exists to prove the country source.
 */
import { randomBytes } from "node:crypto"
import {
  PushRegistrationStatus,
  type Prisma,
  type PrismaClient,
  type PushPlatform,
} from "@prisma/client"
import { z } from "zod"

import {
  PushRegistrationInputSchema,
  type PushRegistrationInput,
} from "./contracts"
import { resolvePushCountry } from "./country"
import { PushInputError, PushInvalidTokenStatusError } from "./errors"
import {
  derivePhoneLanguageSlug,
  type PushLanguageRow,
} from "./language-resolution"
import { canonicalizePushTimeZone } from "./zone-instant"

/** The statuses a caller can see. `INVALID` is refused, never returned. */
export type PushRegistrationReceiptStatus = Exclude<
  PushRegistrationStatus,
  "INVALID"
>

export type PushDeviceRegistrationReceipt = Readonly<{
  /** R31 — the app shows this on its Profile screen; never the token. */
  testDeviceId: string
  status: PushRegistrationReceiptStatus
}>

export type PushRegistrationRequest = Readonly<{
  input: unknown
  /** The edge's country for this request, already read from the header. */
  edgeCountry: string | null
  viewerDigest: string | null
}>

/** A phone registers about once per launch, so the row set is read rarely. */
const LANGUAGE_CACHE_TTL_MS = 5 * 60_000

let languageCache: { rows: PushLanguageRow[]; readAt: number } | null = null
let languageFlight: Promise<PushLanguageRow[]> | null = null

/** Test seam: drops the cached Language rows. */
export function resetPushLanguageCache(): void {
  languageCache = null
  languageFlight = null
}

async function readPushLanguageRows(
  prisma: PrismaClient,
): Promise<PushLanguageRow[]> {
  const fresh =
    languageCache && Date.now() - languageCache.readAt < LANGUAGE_CACHE_TTL_MS
  if (fresh && languageCache) return languageCache.rows
  if (languageFlight) return languageFlight

  const flight = prisma.language
    .findMany({
      where: { deletedAt: null, slug: { not: null }, bcp47: { not: null } },
      select: { slug: true, bcp47: true },
    })
    .then((rows: PushLanguageRow[]) => {
      languageCache = { rows, readAt: Date.now() }
      return rows
    })
  languageFlight = flight
  // The release is caller-side and identity-checked: a body-internal `finally`
  // would race this assignment when the read settles synchronously.
  const release = () => {
    if (languageFlight === flight) languageFlight = null
  }
  void flight.then(release, release)
  return flight
}

type PushPermissionState = PushRegistrationInput["permission"]

export type PushRegistrationStatusStep = Readonly<{
  status: PushRegistrationReceiptStatus
  changed: boolean
}>

/**
 * KTD4's status rules as one pure step. A grant reactivates only from
 * inactive: a superseded row lost its place to the viewer's newer token, and
 * that newer token is the one the audience reads.
 */
export function nextPushRegistrationStatus(
  current: PushRegistrationStatus | null,
  permission: PushPermissionState,
): PushRegistrationStatusStep {
  if (current === PushRegistrationStatus.SUPERSEDED) {
    return { status: PushRegistrationStatus.SUPERSEDED, changed: false }
  }
  const status =
    permission === "granted"
      ? PushRegistrationStatus.ACTIVE
      : PushRegistrationStatus.INACTIVE
  return { status, changed: current !== status }
}

function asInputError(error: unknown): never {
  if (error instanceof z.ZodError) {
    throw new PushInputError(
      error.issues.map((issue) => issue.message).join("; "),
    )
  }
  throw error
}

/** 16 lowercase hex characters, random, and never derived from the token. */
function mintTestDeviceId(): string {
  return randomBytes(8).toString("hex")
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  )
}

type RegistrationRow = {
  id: string
  testDeviceId: string
  status: PushRegistrationStatus
}

type WriteResult = {
  row: RegistrationRow
  outcome: "created" | "refreshed" | "reactivated" | "revoked"
  superseded: number
}

async function writeRegistration(
  tx: Prisma.TransactionClient,
  params: {
    input: PushRegistrationInput
    timeZone: string
    country: string | null
    countrySource: "EDGE" | "PHONE_REGION" | "UNKNOWN"
    phoneLanguageSlug: string | null
    viewerDigest: string | null
    now: Date
  },
): Promise<WriteResult> {
  const { input, now, viewerDigest } = params
  const existing = (await tx.pushRegistration.findUnique({
    where: { expoPushToken: input.expoPushToken },
    select: { id: true, status: true, testDeviceId: true },
  })) as RegistrationRow | null

  if (existing?.status === PushRegistrationStatus.INVALID) {
    throw new PushInvalidTokenStatusError()
  }

  const step = nextPushRegistrationStatus(
    existing?.status ?? null,
    input.permission,
  )
  const common = {
    platform: input.platform as PushPlatform,
    appBuild: input.appBuild,
    appLanguageSlug: input.appLanguageSlug,
    phoneLocale: input.phoneLocale,
    phoneLanguageSlug: params.phoneLanguageSlug,
    timeZone: params.timeZone,
    country: params.country,
    countrySource: params.countrySource,
    refreshedAt: now,
    // A registration with no handle leaves the stored digest alone; only a
    // viewer erasure clears it.
    ...(viewerDigest ? { viewerDigest } : {}),
  }

  const row = existing
    ? ((await tx.pushRegistration.update({
        where: { id: existing.id },
        data: {
          ...common,
          ...(step.changed
            ? { status: step.status, statusChangedAt: now }
            : {}),
        },
        select: { id: true, testDeviceId: true, status: true },
      })) as RegistrationRow)
    : ((await tx.pushRegistration.create({
        data: {
          ...common,
          expoPushToken: input.expoPushToken,
          testDeviceId: mintTestDeviceId(),
          status: step.status,
          statusChangedAt: now,
        },
        select: { id: true, testDeviceId: true, status: true },
      })) as RegistrationRow)

  let superseded = 0
  if (viewerDigest && row.status === PushRegistrationStatus.ACTIVE) {
    const result = await tx.pushRegistration.updateMany({
      where: {
        viewerDigest,
        platform: input.platform as PushPlatform,
        status: PushRegistrationStatus.ACTIVE,
        id: { not: row.id },
      },
      data: {
        status: PushRegistrationStatus.SUPERSEDED,
        statusChangedAt: now,
      },
    })
    superseded = result.count
  }

  const outcome: WriteResult["outcome"] = !existing
    ? "created"
    : !step.changed
      ? "refreshed"
      : step.status === PushRegistrationStatus.ACTIVE
        ? "reactivated"
        : "revoked"
  return { row, outcome, superseded }
}

/**
 * Registers or refreshes one phone. The receipt carries the phone's test ID so
 * the Profile screen can show it on every launch.
 */
export async function registerPushDevice(
  prisma: PrismaClient,
  request: PushRegistrationRequest,
): Promise<PushDeviceRegistrationReceipt> {
  let input: PushRegistrationInput
  try {
    input = PushRegistrationInputSchema.parse(request.input)
  } catch (error) {
    asInputError(error)
  }

  const timeZone = canonicalizePushTimeZone(input.timeZone)
  const country = resolvePushCountry({
    edgeCountry: request.edgeCountry,
    phoneLocale: input.phoneLocale,
  })
  const languages = await readPushLanguageRows(prisma)
  const phoneLanguageSlug = derivePhoneLanguageSlug(
    input.phoneLocale,
    languages,
  )

  const params = {
    input,
    timeZone,
    country: country.country,
    countrySource: country.source,
    phoneLanguageSlug,
    viewerDigest: request.viewerDigest,
    now: new Date(),
  }

  let written: WriteResult | null = null
  for (let attempt = 0; attempt < 2 && written === null; attempt++) {
    try {
      written = await prisma.$transaction((tx) => writeRegistration(tx, params))
    } catch (error) {
      // Two launches of one phone can race the read. The retry re-reads the
      // row the other call wrote and updates it.
      if (attempt === 0 && isUniqueViolation(error)) continue
      throw error
    }
  }
  if (written === null)
    throw new PushInputError("That registration did not store")

  console.info(
    `[push] event=register platform=${input.platform.toLowerCase()} country_source=${country.source.toLowerCase()} status=${written.row.status.toLowerCase()} outcome=${written.outcome} superseded=${written.superseded}`,
  )

  return {
    testDeviceId: written.row.testDeviceId,
    status: written.row.status as PushRegistrationReceiptStatus,
  }
}
