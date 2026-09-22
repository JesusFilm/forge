/**
 * R1 to R5, R14 and R29 — one phone registers, refreshes, and reports that its
 * permission is gone.
 *
 * The push token is the identity of the row, so every call is an upsert on it.
 * KTD4 owns the status rules: invalid is terminal, a revoked grant is
 * inactive, and one install's newest token supersedes that install's older
 * ones. A viewer with a phone and a tablet keeps an active row on each.
 *
 * SECURITY: no log line here carries the push token, an install id, a viewer
 * handle, or a digest. The registration log exists to prove the country source.
 */
import { randomBytes } from "node:crypto"
import {
  PushRegistrationStatus,
  type Prisma,
  type PrismaClient,
  type PushPlatform,
} from "@prisma/client"

import {
  parsePushInput,
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
import { isUniqueViolation } from "@/db/prisma-errors"

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
 * KTD4's status rules as one pure step. A superseded row is one install's
 * retired token, so a grant reactivates it: the install's newest granted token
 * is the row the audience reads. An invalid token never reaches here.
 */
export function nextPushRegistrationStatus(
  current: PushRegistrationStatus | null,
  permission: PushPermissionState,
): PushRegistrationStatusStep {
  const status =
    permission === "granted"
      ? PushRegistrationStatus.ACTIVE
      : PushRegistrationStatus.INACTIVE
  return { status, changed: current !== status }
}

/** 16 lowercase hex characters, random, and never derived from the token. */
function mintTestDeviceId(): string {
  return randomBytes(8).toString("hex")
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
  const installId = input.installId ?? null
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
    // An app build older than the install id sends none, so the stored id
    // stays and that install keeps its supersession key.
    ...(installId ? { installId } : {}),
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
  // Keyed on the install, never on the viewer: one person's phone and tablet
  // are two installs and both stay active.
  if (installId && row.status === PushRegistrationStatus.ACTIVE) {
    const result = await tx.pushRegistration.updateMany({
      where: {
        installId,
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
  const input: PushRegistrationInput = parsePushInput(
    PushRegistrationInputSchema,
    request.input,
  )

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
