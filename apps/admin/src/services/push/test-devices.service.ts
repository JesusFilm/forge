/**
 * R31 — the test-device list. An admin user pastes the notification test ID a
 * phone shows on its Profile screen, with a label.
 *
 * The ID is never the push token, so a token-shaped string is refused before
 * anything else happens: a pasted token in an admin table is a leak, and the
 * refusal says which value the editor should paste instead.
 */
import {
  PushRegistrationStatus,
  type PrismaClient,
  type PushPlatform,
} from "@prisma/client"
import { z } from "zod"

import type { PushAudienceRegistration } from "./audience.service"
import { PushTestDeviceAddInputSchema, isExpoPushTokenShape } from "./contracts"
import {
  PushDuplicateTestDeviceError,
  PushInputError,
  PushNotFoundError,
  PushTokenShapedIdError,
} from "./errors"
import { isUniqueViolation } from "@/db/prisma-errors"

export const PUSH_TEST_DEVICE_PAGE_LIMIT = 200

export type PushTestDeviceRow = Readonly<{
  id: string
  label: string
  testDeviceId: string
  registrationId: string
  platform: PushPlatform
  active: boolean
  createdAt: Date
  createdById: string | null
}>

const TEST_DEVICE_SELECT = {
  id: true,
  label: true,
  createdAt: true,
  createdById: true,
  registration: {
    select: { id: true, testDeviceId: true, platform: true, status: true },
  },
} as const

type TestDeviceSelection = {
  id: string
  label: string
  createdAt: Date
  createdById: string | null
  registration: {
    id: string
    testDeviceId: string
    platform: PushPlatform
    status: PushRegistrationStatus
  }
}

function toRow(row: TestDeviceSelection): PushTestDeviceRow {
  return {
    id: row.id,
    label: row.label,
    testDeviceId: row.registration.testDeviceId,
    registrationId: row.registration.id,
    platform: row.registration.platform,
    active: row.registration.status === PushRegistrationStatus.ACTIVE,
    createdAt: row.createdAt,
    createdById: row.createdById,
  }
}

async function readRegistration(
  prisma: PrismaClient,
  testDeviceId: string,
): Promise<{ id: string; testDevice: { label: string } | null } | null> {
  return prisma.pushRegistration.findUnique({
    where: { testDeviceId },
    select: { id: true, testDevice: { select: { label: true } } },
  })
}

/** Adds a labelled test phone. A duplicate refusal names the existing label. */
export async function addPushTestDevice(
  prisma: PrismaClient,
  input: { testDeviceId: string; label: string; actorId: string },
): Promise<PushTestDeviceRow> {
  if (isExpoPushTokenShape(input.testDeviceId)) {
    throw new PushTokenShapedIdError()
  }
  let parsed: { testDeviceId: string; label: string }
  try {
    parsed = PushTestDeviceAddInputSchema.parse({
      testDeviceId: input.testDeviceId,
      label: input.label,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new PushInputError(
        error.issues.map((issue) => issue.message).join("; "),
      )
    }
    throw error
  }

  const registration = await readRegistration(prisma, parsed.testDeviceId)
  if (registration == null) {
    throw new PushNotFoundError(
      "No phone has reported that notification test ID yet",
    )
  }
  if (registration.testDevice) {
    throw new PushDuplicateTestDeviceError(registration.testDevice.label)
  }

  try {
    const created = (await prisma.pushTestDevice.create({
      data: {
        label: parsed.label,
        registrationId: registration.id,
        createdById: input.actorId,
      },
      select: TEST_DEVICE_SELECT,
    })) as TestDeviceSelection
    return toRow(created)
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    // Another admin user listed the same phone between the read and the write.
    const raced = await readRegistration(prisma, parsed.testDeviceId)
    throw new PushDuplicateTestDeviceError(
      raced?.testDevice?.label ?? parsed.label,
    )
  }
}

export async function listPushTestDevices(
  prisma: PrismaClient,
  limit = PUSH_TEST_DEVICE_PAGE_LIMIT,
): Promise<PushTestDeviceRow[]> {
  const rows = (await prisma.pushTestDevice.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: TEST_DEVICE_SELECT,
  })) as TestDeviceSelection[]
  return rows.map(toRow)
}

/**
 * The phones a test send reaches (KTD2). Only active registrations: a retired
 * phone has no address, so it would fail the send rather than prove it.
 */
export async function readPushTestDeviceRegistrations(
  prisma: PrismaClient,
  limit = PUSH_TEST_DEVICE_PAGE_LIMIT,
): Promise<PushAudienceRegistration[]> {
  return (await prisma.pushRegistration.findMany({
    where: {
      status: PushRegistrationStatus.ACTIVE,
      testDevice: { isNot: null },
    },
    orderBy: { id: "asc" },
    take: limit,
    select: {
      id: true,
      expoPushToken: true,
      platform: true,
      appLanguageSlug: true,
      phoneLanguageSlug: true,
      phoneLocale: true,
      timeZone: true,
      country: true,
    },
  })) as PushAudienceRegistration[]
}

/** `false` means the row was already gone, which is not an error. */
export async function removePushTestDevice(
  prisma: PrismaClient,
  id: string,
): Promise<boolean> {
  const { count } = await prisma.pushTestDevice.deleteMany({ where: { id } })
  return count > 0
}
