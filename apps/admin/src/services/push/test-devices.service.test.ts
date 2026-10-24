import { describe, expect, it, vi } from "vitest"

import {
  PushDuplicateTestDeviceError,
  PushInputError,
  PushNotFoundError,
  PushTokenShapedIdError,
} from "./errors"
import {
  PUSH_TEST_DEVICE_PAGE_LIMIT,
  addPushTestDevice,
  listPushTestDevices,
  readPushTestDeviceRegistrations,
  removePushTestDevice,
} from "./test-devices.service"

/**
 * What these suites read back off a mocked Prisma call. Every field is
 * declared present because the assertions below name the ones they read.
 */
type PrismaCallArgs = {
  where: Record<string, unknown>
  data: Record<string, unknown>
  orderBy: unknown
  take: number
  select: unknown
}

const TEST_ID = "cl9x8k2p0000qwertyuiopas"
const ACTOR = "user_1"

function buildClient(
  options: {
    registration?: { id: string; testDevice: { label: string } | null } | null
  } = {},
) {
  const registration =
    options.registration === undefined
      ? { id: "reg_1", testDevice: null }
      : options.registration
  return {
    pushRegistration: {
      findUnique: vi.fn(async (_args: PrismaCallArgs) => registration),
      findMany: vi.fn(async (_args: PrismaCallArgs) => []),
    },
    pushTestDevice: {
      create: vi.fn(async (_args: PrismaCallArgs) => ({
        id: "device_row_1",
        label: "Urim iPhone",
        createdAt: new Date("2026-10-01T09:00:00.000Z"),
        createdById: ACTOR,
        registration: {
          id: "reg_1",
          testDeviceId: TEST_ID,
          platform: "IOS",
          status: "ACTIVE",
        },
      })),
      findMany: vi.fn(async (_args: PrismaCallArgs) => []),
      deleteMany: vi.fn(async (_args: PrismaCallArgs) => ({ count: 1 })),
    },
  }
}

describe("adding a push test device", () => {
  it("resolves the pasted test ID to its registration", async () => {
    const client = buildClient()

    const added = await addPushTestDevice(client as never, {
      testDeviceId: `  ${TEST_ID}  `,
      label: "Urim iPhone",
      actorId: ACTOR,
    })

    expect(client.pushRegistration.findUnique).toHaveBeenCalledWith({
      where: { testDeviceId: TEST_ID },
      select: { id: true, testDevice: { select: { label: true } } },
    })
    expect(client.pushTestDevice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          label: "Urim iPhone",
          registrationId: "reg_1",
          createdById: ACTOR,
        },
      }),
    )
    expect(added.label).toBe("Urim iPhone")
  })

  it("refuses a string in push-token shape (R31)", async () => {
    const client = buildClient()

    await expect(
      addPushTestDevice(client as never, {
        testDeviceId: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
        label: "Urim iPhone",
        actorId: ACTOR,
      }),
    ).rejects.toThrowError(PushTokenShapedIdError)
    expect(client.pushRegistration.findUnique).not.toHaveBeenCalled()
  })

  it("refuses a bare device token as well", async () => {
    const client = buildClient()

    await expect(
      addPushTestDevice(client as never, {
        testDeviceId: "F9E7C2A1-1111-2222-3333-444455556666",
        label: "Urim iPhone",
        actorId: ACTOR,
      }),
    ).rejects.toThrowError(PushTokenShapedIdError)
  })

  it("refuses an ID that is not test-ID shaped", async () => {
    const client = buildClient()

    await expect(
      addPushTestDevice(client as never, {
        testDeviceId: "short",
        label: "Urim iPhone",
        actorId: ACTOR,
      }),
    ).rejects.toThrowError(PushInputError)
  })

  it("refuses an empty label", async () => {
    const client = buildClient()

    await expect(
      addPushTestDevice(client as never, {
        testDeviceId: TEST_ID,
        label: "   ",
        actorId: ACTOR,
      }),
    ).rejects.toThrowError(PushInputError)
  })

  it("refuses an ID no phone has reported", async () => {
    const client = buildClient({ registration: null })

    await expect(
      addPushTestDevice(client as never, {
        testDeviceId: TEST_ID,
        label: "Urim iPhone",
        actorId: ACTOR,
      }),
    ).rejects.toThrowError(PushNotFoundError)
  })

  it("names the existing label when the ID is already listed", async () => {
    const client = buildClient({
      registration: { id: "reg_1", testDevice: { label: "Jian Wei Pixel" } },
    })

    const error = await addPushTestDevice(client as never, {
      testDeviceId: TEST_ID,
      label: "Urim iPhone",
      actorId: ACTOR,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PushDuplicateTestDeviceError)
    expect((error as PushDuplicateTestDeviceError).existingLabel).toBe(
      "Jian Wei Pixel",
    )
    expect((error as Error).message).toContain("Jian Wei Pixel")
    expect(client.pushTestDevice.create).not.toHaveBeenCalled()
  })

  it("names the existing label when a second admin wins the race", async () => {
    const client = buildClient()
    client.pushTestDevice.create = vi.fn(async (_args: PrismaCallArgs) => {
      throw Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        name: "PrismaClientKnownRequestError",
      })
    }) as never
    client.pushRegistration.findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: "reg_1", testDevice: null })
      .mockResolvedValueOnce({
        id: "reg_1",
        testDevice: { label: "Added first" },
      }) as never

    const error = await addPushTestDevice(client as never, {
      testDeviceId: TEST_ID,
      label: "Urim iPhone",
      actorId: ACTOR,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PushDuplicateTestDeviceError)
    expect((error as PushDuplicateTestDeviceError).existingLabel).toBe(
      "Added first",
    )
  })
})

describe("reading the push test device list", () => {
  it("reads the list under a page limit", async () => {
    const client = buildClient()

    await listPushTestDevices(client as never)

    const [read] = client.pushTestDevice.findMany.mock.calls[0]
    expect(read.take).toBe(PUSH_TEST_DEVICE_PAGE_LIMIT)
    expect(read.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }])
  })

  it("reads the test phones a test send reaches, active only, under a limit", async () => {
    const client = buildClient()

    await readPushTestDeviceRegistrations(client as never)

    const [read] = client.pushRegistration.findMany.mock.calls[0]
    expect(read.where).toEqual({
      status: "ACTIVE",
      testDevice: { isNot: null },
    })
    expect(read.take).toBe(PUSH_TEST_DEVICE_PAGE_LIMIT)
    expect(read.orderBy).toEqual({ id: "asc" })
  })
})

describe("removing a push test device", () => {
  it("removes the row and reports that it went", async () => {
    const client = buildClient()

    expect(await removePushTestDevice(client as never, "device_row_1")).toBe(
      true,
    )
    expect(client.pushTestDevice.deleteMany).toHaveBeenCalledWith({
      where: { id: "device_row_1" },
    })
  })

  it("reports a row that was already gone", async () => {
    const client = buildClient()
    client.pushTestDevice.deleteMany = vi.fn(async (_args: PrismaCallArgs) => ({
      count: 0,
    })) as never

    expect(await removePushTestDevice(client as never, "device_row_1")).toBe(
      false,
    )
  })
})
