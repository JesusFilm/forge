import { randomUUID } from "node:crypto"
import { describe, it, expect } from "vitest"
import { StudioRenderPoolAuth } from "./studio-render-pool-auth"

const config = {
  poolId: "pool",
  workerId: "worker",
  workerKey: "worker-key-" + "a".repeat(40),
  capabilityKey: "server-only-key-" + "b".repeat(40),
}
const assignment = {
  poolId: "pool",
  workerId: "worker",
  dispatchId: randomUUID(),
  attemptId: "attempt",
  leaseId: randomUUID(),
  expiresAt: 200000,
}
describe("scoped render pool authority", () => {
  it("authenticates only the dedicated worker secret, deriving identity from configuration", () => {
    const auth = new StudioRenderPoolAuth(config)
    expect(auth.worker(`Bearer ${config.workerKey}`)).toEqual({
      poolId: "pool",
      workerId: "worker",
    })
    for (const value of [
      null,
      "Bearer generic-service-key",
      `Bearer ${config.capabilityKey}`,
    ])
      expect(() => auth.worker(value)).toThrow(
        "Render pool authorization refused",
      )
  })
  it("binds a signed capability to the exact immutable lease and rejects tampering or another worker", () => {
    const auth = new StudioRenderPoolAuth(config)
    const token = auth.issue(assignment, "c".repeat(64), 100000)
    expect(auth.lease(token, 100001)).toMatchObject({
      assignment,
      inputHash: "c".repeat(64),
    })
    expect(() => auth.lease(token + "x", 100001)).toThrow(
      "authorization refused",
    )
    expect(() =>
      new StudioRenderPoolAuth({ ...config, workerId: "other" }).lease(
        token,
        100001,
      ),
    ).toThrow("authorization refused")
    expect(() =>
      auth.issue({ ...assignment, workerId: "other" }, "c".repeat(64), 100000),
    ).toThrow("authorization refused")
  })
  it("expires capability transport and permits bounded fresh retention authority without extending the original lease", () => {
    const auth = new StudioRenderPoolAuth(config)
    const old = auth.issue(assignment, "c".repeat(64), 100000)
    expect(() => auth.lease(old, 260001)).toThrow("authorization refused")
    const renewed = auth.lease(
      auth.issue(assignment, "c".repeat(64), 300000),
      300001,
    )
    expect(renewed.assignment.expiresAt).toBe(200000)
    expect(renewed.capabilityExpiresAt).toBe(360000)
    // Renewed transport authority cannot make an expired canonical lease current.
    // Every input/readiness decision still calls the canonical owns predicate.
  })
})
it("accepts only broker-signed exact terminal records and preserves them beyond lease expiry for receipt replay", () => {
  const auth = new StudioRenderPoolAuth(config)
  const record = {
    attemptId: assignment.attemptId,
    leaseId: assignment.leaseId,
    status: "FAILED" as const,
    result: { assets: [], costMicros: null, diagnostic: "Retained fixture" },
  }
  const sealed = auth.sealSettlement(assignment, "c".repeat(64), record)
  expect(auth.settlement(sealed)).toEqual({
    audience: "studio-render-settlement/1",
    assignment,
    inputHash: "c".repeat(64),
    record,
  })
  expect(() => auth.settlement(sealed + "x")).toThrow("authorization refused")
  expect(() => auth.settlement(auth.issue(assignment, "c".repeat(64)))).toThrow(
    "authorization refused",
  )
  expect(() =>
    auth.sealSettlement(assignment, "c".repeat(64), {
      ...record,
      leaseId: randomUUID(),
    }),
  ).toThrow("authorization refused")
})
