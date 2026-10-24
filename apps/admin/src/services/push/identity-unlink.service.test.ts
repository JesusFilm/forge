import { describe, expect, it, vi } from "vitest"

import { unlinkPushViewerIdentities } from "./identity-unlink.service"

function buildClient() {
  return {
    pushAttribution: { deleteMany: vi.fn(async () => ({ count: 2 })) },
    pushOpen: { deleteMany: vi.fn(async () => ({ count: 3 })) },
    pushRegistration: { updateMany: vi.fn(async () => ({ count: 1 })) },
  }
}

const DIGEST_A = "a".repeat(64)
const DIGEST_B = "b".repeat(64)

describe("push identity unlink", () => {
  it("nulls the digest on the registration and deletes that digest's rows", async () => {
    const client = buildClient()

    const result = await unlinkPushViewerIdentities(client as never, [DIGEST_A])

    expect(result).toEqual({
      registrationsUnlinked: 1,
      opensDeleted: 3,
      attributionsDeleted: 2,
    })
    expect(client.pushAttribution.deleteMany).toHaveBeenCalledWith({
      where: { viewerDigest: { in: [DIGEST_A] } },
    })
    expect(client.pushOpen.deleteMany).toHaveBeenCalledWith({
      where: { viewerDigest: { in: [DIGEST_A] } },
    })
    expect(client.pushRegistration.updateMany).toHaveBeenCalledWith({
      where: { viewerDigest: { in: [DIGEST_A] } },
      data: { viewerDigest: null },
    })
  })

  it("never deletes a registration", async () => {
    const client = buildClient() as Record<string, unknown>
    client.pushRegistration = {
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(),
      delete: vi.fn(),
    }

    await unlinkPushViewerIdentities(client as never, [DIGEST_A])

    const registration = client.pushRegistration as {
      deleteMany: ReturnType<typeof vi.fn>
      delete: ReturnType<typeof vi.fn>
    }
    expect(registration.deleteMany).not.toHaveBeenCalled()
    expect(registration.delete).not.toHaveBeenCalled()
  })

  it("takes every digest of a purged page in one statement each", async () => {
    const client = buildClient()

    await unlinkPushViewerIdentities(client as never, [
      DIGEST_A,
      DIGEST_B,
      DIGEST_A,
    ])

    expect(client.pushOpen.deleteMany).toHaveBeenCalledOnce()
    expect(client.pushOpen.deleteMany).toHaveBeenCalledWith({
      where: { viewerDigest: { in: [DIGEST_A, DIGEST_B] } },
    })
  })

  it("touches nothing when no digest is supplied", async () => {
    const client = buildClient()

    const result = await unlinkPushViewerIdentities(client as never, [])

    expect(result).toEqual({
      registrationsUnlinked: 0,
      opensDeleted: 0,
      attributionsDeleted: 0,
    })
    expect(client.pushAttribution.deleteMany).not.toHaveBeenCalled()
    expect(client.pushOpen.deleteMany).not.toHaveBeenCalled()
    expect(client.pushRegistration.updateMany).not.toHaveBeenCalled()
  })
})
