import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { CONSUMER_BEARER_PRINCIPAL, type Principal } from "@/auth/principal"
import { fleetKeyIdFromRawKey } from "@/auth/fleet-key-id"

import { admitPushWrite } from "./admission"
import { PushAdmissionError, PushViewerHandleRejectedError } from "./errors"

const VIEWER_TOKEN = "v".repeat(43)
const SESSION_TOKEN = "s".repeat(43)
const VIEWER_DIGEST = createHash("sha256").update(VIEWER_TOKEN).digest("hex")
const SESSION_DIGEST = createHash("sha256").update(SESSION_TOKEN).digest("hex")

const FLEET_KEY = "fleet-key-value"

function fleetCaller(): Principal {
  return CONSUMER_BEARER_PRINCIPAL({
    rateLimitBucketKey: FLEET_KEY,
    fleet: true,
  })
}

function webCaller(): Principal {
  return CONSUMER_BEARER_PRINCIPAL({ rateLimitBucketKey: "web-key" })
}

function buildPrisma(
  viewer: { tokenDigest: string; expiresAt: Date } | null = {
    tokenDigest: VIEWER_DIGEST,
    expiresAt: new Date(Date.now() + 86_400_000),
  },
) {
  return {
    recommendationViewer: {
      findUnique: vi.fn(async () => viewer),
    },
  }
}

describe("push write admission", () => {
  it("admits a fleet bearer with no viewer handle", async () => {
    const admission = await admitPushWrite(buildPrisma() as never, {
      caller: fleetCaller(),
      handle: {},
    })
    expect(admission).toEqual({
      fleetKeyId: fleetKeyIdFromRawKey(FLEET_KEY),
      viewerDigest: null,
      sessionDigest: null,
    })
  })

  it("admits web SSR's own bearer with no fleet key id", async () => {
    const admission = await admitPushWrite(buildPrisma() as never, {
      caller: webCaller(),
      handle: {},
    })
    expect(admission.fleetKeyId).toBeNull()
  })

  it("refuses a caller with no bearer", async () => {
    await expect(
      admitPushWrite(buildPrisma() as never, { caller: null, handle: {} }),
    ).rejects.toThrowError(PushAdmissionError)
  })

  it("refuses an editorial session, which is not a consumer bearer", async () => {
    await expect(
      admitPushWrite(buildPrisma() as never, {
        caller: { id: "user_1", role: "EDITOR" },
        handle: {},
      }),
    ).rejects.toThrowError(PushAdmissionError)
  })

  it("refuses a consumer bearer with no bucket key", async () => {
    await expect(
      admitPushWrite(buildPrisma() as never, {
        caller: { id: null, role: "CONSUMER_BEARER" },
        handle: {},
      }),
    ).rejects.toThrowError(PushAdmissionError)
  })

  it("verifies a viewer handle and returns both digests", async () => {
    const prisma = buildPrisma()
    const admission = await admitPushWrite(prisma as never, {
      caller: fleetCaller(),
      handle: { viewerToken: VIEWER_TOKEN, sessionToken: SESSION_TOKEN },
    })
    expect(admission).toEqual({
      fleetKeyId: fleetKeyIdFromRawKey(FLEET_KEY),
      viewerDigest: VIEWER_DIGEST,
      sessionDigest: SESSION_DIGEST,
    })
    expect(prisma.recommendationViewer.findUnique).toHaveBeenCalledWith({
      where: { tokenDigest: VIEWER_DIGEST },
    })
  })

  it("refuses an unknown viewer handle instead of degrading to anonymous", async () => {
    const refusal = admitPushWrite(buildPrisma(null) as never, {
      caller: fleetCaller(),
      handle: { viewerToken: VIEWER_TOKEN, sessionToken: SESSION_TOKEN },
    })
    await expect(refusal).rejects.toThrowError(PushViewerHandleRejectedError)
    // The app re-checks its handle only on this code, so it must not share the
    // missing-bearer code.
    await expect(refusal).rejects.toMatchObject({
      code: "viewer_handle_rejected",
    })
    await expect(refusal).rejects.not.toBeInstanceOf(PushAdmissionError)
  })

  it("refuses an expired viewer handle", async () => {
    const expired = buildPrisma({
      tokenDigest: VIEWER_DIGEST,
      expiresAt: new Date(Date.now() - 1000),
    })
    await expect(
      admitPushWrite(expired as never, {
        caller: fleetCaller(),
        handle: { viewerToken: VIEWER_TOKEN, sessionToken: SESSION_TOKEN },
      }),
    ).rejects.toMatchObject({ code: "viewer_handle_rejected" })
  })

  it("rethrows a database fault instead of calling the handle rejected", async () => {
    // A fault is not the handle's fault: calling it rejected would make the
    // app re-check a sound handle on every outage.
    const fault = new Error("connection terminated")
    const prisma = {
      recommendationViewer: {
        findUnique: vi.fn(async () => {
          throw fault
        }),
      },
    }
    await expect(
      admitPushWrite(prisma as never, {
        caller: fleetCaller(),
        handle: { viewerToken: VIEWER_TOKEN, sessionToken: SESSION_TOKEN },
      }),
    ).rejects.toBe(fault)
  })

  it("refuses a malformed viewer token as a rejected handle", async () => {
    // The app's re-check replaces a token Admin cannot parse, so it takes the
    // code that starts the re-check.
    await expect(
      admitPushWrite(buildPrisma() as never, {
        caller: fleetCaller(),
        handle: { viewerToken: "short", sessionToken: SESSION_TOKEN },
      }),
    ).rejects.toMatchObject({ code: "viewer_handle_rejected" })
  })

  it.each([
    ["only the viewer half", { viewerToken: VIEWER_TOKEN }],
    ["only the session half", { sessionToken: SESSION_TOKEN }],
  ])("refuses %s", async (_name, handle) => {
    // A handle with a missing half is an app fault that a re-check cannot
    // repair, so it keeps the general code.
    await expect(
      admitPushWrite(buildPrisma() as never, {
        caller: fleetCaller(),
        handle,
      }),
    ).rejects.toMatchObject({ code: "admission_denied" })
  })

  it("admits a fleet bearer that carries no viewer handle at all", async () => {
    // The recommendation caller check rejects exactly this caller. Push must
    // not, or an install with no viewer identity could never register.
    const admission = await admitPushWrite(buildPrisma() as never, {
      caller: fleetCaller(),
      handle: { viewerToken: null, sessionToken: null },
    })
    expect(admission.viewerDigest).toBeNull()
  })

  it("never writes the handle or a digest to a log line", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    )
    try {
      await admitPushWrite(buildPrisma() as never, {
        caller: fleetCaller(),
        handle: { viewerToken: VIEWER_TOKEN, sessionToken: SESSION_TOKEN },
      })
      await admitPushWrite(buildPrisma(null) as never, {
        caller: fleetCaller(),
        handle: { viewerToken: VIEWER_TOKEN, sessionToken: SESSION_TOKEN },
      }).catch(() => undefined)
      const combined = spies
        .flatMap((spy) => spy.mock.calls.map((args) => String(args[0] ?? "")))
        .join("\n")
      expect(combined).not.toContain(VIEWER_TOKEN)
      expect(combined).not.toContain(VIEWER_DIGEST)
      expect(combined).not.toContain(FLEET_KEY)
    } finally {
      spies.forEach((spy) => spy.mockRestore())
    }
  })
})
