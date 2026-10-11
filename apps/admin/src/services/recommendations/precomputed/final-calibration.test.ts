import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  reconcileFinalCalibrationLoss,
  verifyFinalCalibrationAssertion,
} from "./final-calibration"

const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const publicKeyPem = publicKey
  .export({ format: "pem", type: "spki" })
  .toString()
const keyring = JSON.stringify({
  "edge-key-1": {
    sourceId: "independent-edge-1",
    boundMethod: "edge-census-upper-v1",
    publicKeyPem,
  },
})
const now = new Date("2026-10-03T00:05:00.000Z")
const claims = () => ({
  contractVersion: "precomputed-final-calibration-v1",
  authority: "independent_browser_edge",
  sourceId: "independent-edge-1",
  sourceRunId: "edge-run-1",
  experimentId: "trial-7",
  generationId: "generation-7",
  configurationDigest: "a".repeat(64),
  policyDigest: "b".repeat(64),
  startsAt: "2026-10-01T00:00:00.000Z",
  endsAt: "2026-10-02T00:00:00.000Z",
  finalAt: "2026-10-03T00:00:00.000Z",
  observedAt: "2026-10-03T00:03:00.000Z",
  collectionMode: "independent_initiation_and_web_receipt_v1",
  boundMethod: "edge-census-upper-v1",
  coverage: "complete",
  dropRetryProbe: "passed",
  deliveryInitiated: 101,
  deliveryReachedWeb: 100,
  clickInitiated: 22,
  clickReachedWeb: 21,
  lossUpperBoundRate: 0.08,
  quietHourBits: Buffer.from([0, 0, 0, 255, 255, 255]).toString("base64url"),
})

function signed(value: ReturnType<typeof claims>) {
  const header = Buffer.from(
    JSON.stringify({
      alg: "EdDSA",
      typ: "precomputed-calibration+jws",
      kid: "edge-key-1",
    }),
  ).toString("base64url")
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url")
  const input = `${header}.${payload}`
  const signature = sign(null, Buffer.from(input), privateKey).toString(
    "base64url",
  )
  return `${input}.${signature}`
}

describe("independently signed final calibration", () => {
  it("charges reached-but-unattributed requests and observed failures to the owner loss bound", () => {
    const source = {
      deliveryInitiated: 1_000,
      deliveryReachedWeb: 1_000,
      clickInitiated: 1_000,
      clickReachedWeb: 1_000,
      lossUpperBoundRate: 0,
    }
    const scoped = {
      delivery_attempt: 10,
      delivery_response_failed: 0,
      click_attempt: 10,
      click_unavailable: 0,
    }
    expect(reconcileFinalCalibrationLoss(source, scoped)).toMatchObject({
      upperBoundRate: 0.99,
      unattributedDeliveryAttempts: 990,
      unattributedClickAttempts: 990,
    })
    expect(
      reconcileFinalCalibrationLoss(
        {
          ...source,
          deliveryInitiated: 10,
          deliveryReachedWeb: 10,
          clickInitiated: 10,
          clickReachedWeb: 10,
        },
        { ...scoped, delivery_response_failed: 1, click_unavailable: 1 },
      ),
    ).toMatchObject({ upperBoundRate: 0.1 })
    expect(
      reconcileFinalCalibrationLoss(
        {
          ...source,
          deliveryInitiated: 10,
          deliveryReachedWeb: 9,
          clickInitiated: 10,
          clickReachedWeb: 10,
        },
        scoped,
      ),
    ).toBeNull()
  })

  it("binds a complete, fresh horizon to a configured external source", async () => {
    const assertion = signed(claims())
    const result = await verifyFinalCalibrationAssertion(
      assertion,
      keyring,
      now,
    )
    expect(result).toMatchObject({
      keyId: "edge-key-1",
      sourceId: "independent-edge-1",
      assertionDigest: createHash("sha256").update(assertion).digest("hex"),
      claims: { lossUpperBoundRate: 0.08 },
    })
  })

  it("rejects tampering, untrusted sources, stale evidence, and incomplete probes", async () => {
    const assertion = signed(claims())
    const parts = assertion.split(".")
    const tampered = `${parts[0]}.${Buffer.from(
      JSON.stringify({ ...claims(), lossUpperBoundRate: 0 }),
    ).toString("base64url")}.${parts[2]}`
    await expect(
      verifyFinalCalibrationAssertion(tampered, keyring, now),
    ).rejects.toMatchObject({ code: "invalid_assertion" })
    await expect(
      verifyFinalCalibrationAssertion(assertion, "{}", now),
    ).rejects.toMatchObject({ code: "untrusted_attestor" })
    await expect(
      verifyFinalCalibrationAssertion(
        assertion,
        keyring,
        new Date("2026-10-03T01:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "stale_assertion" })
    await expect(
      verifyFinalCalibrationAssertion(
        signed({ ...claims(), dropRetryProbe: "failed" }),
        keyring,
        now,
      ),
    ).rejects.toMatchObject({ code: "incomplete_calibration" })
  })
})
