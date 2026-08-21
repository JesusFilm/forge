import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"

import {
  ConsumerLifecycleSignatureError,
  verifyConsumerLifecycleRequest,
} from "./consumer-lifecycle-signature"

function signedRequest(body: string, timestamp: string, secret: string) {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")
  return new Request(
    "https://admin.example.test/api/internal/user-playlists/lifecycle",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forge-lifecycle-timestamp": timestamp,
        "x-forge-lifecycle-signature": `v1=${signature}`,
      },
      body,
    },
  )
}

describe("verifyConsumerLifecycleRequest", () => {
  const secret = "lifecycle-secret"
  const now = new Date("2026-08-21T12:00:00.000Z")
  const body = JSON.stringify({
    ownerSubject: "consumer-1",
    state: "ACTIVE",
    version: "7",
    sourceEventId: "event-1",
    activeLeaseExpiresAt: "2026-08-21T12:05:00.000Z",
  })

  it("returns the exact signed body as a lifecycle event", async () => {
    await expect(
      verifyConsumerLifecycleRequest(
        signedRequest(body, String(now.getTime()), secret),
        { secret, now: () => now },
      ),
    ).resolves.toEqual({
      ownerSubject: "consumer-1",
      state: "ACTIVE",
      version: 7n,
      sourceEventId: "event-1",
      activeLeaseExpiresAt: new Date("2026-08-21T12:05:00.000Z"),
    })
  })

  it("rejects forged and stale requests", async () => {
    await expect(
      verifyConsumerLifecycleRequest(
        signedRequest(body, String(now.getTime()), `${secret}-wrong`),
        { secret, now: () => now },
      ),
    ).rejects.toBeInstanceOf(ConsumerLifecycleSignatureError)
    await expect(
      verifyConsumerLifecycleRequest(
        signedRequest(body, String(now.getTime() - 5 * 60_000 - 1), secret),
        { secret, now: () => now },
      ),
    ).rejects.toBeInstanceOf(ConsumerLifecycleSignatureError)
  })
})
