import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import type { Principal } from "@/auth/principal"
import { MANAGER_BACKEND_PRINCIPAL } from "@/auth/principal"
import { ManagerExecutionService } from "./manager-execution.service"

const input = {
  jobId: "job",
  runId: "run",
  inputDigest: "a".repeat(64),
  operationId: "run-admission",
  operationDigest: "b".repeat(64),
}

describe("Manager execution service authority and validation", () => {
  it.each<Principal | null>([
    null,
    { id: "admin", role: "ADMIN" },
    { id: "operator", role: "EDITOR", managerRole: "OPERATOR" },
    { id: null, role: "SYSTEM" },
    { id: null, role: "WORKFLOW_TRIGGER" },
    { id: null, role: "CONSUMER_BEARER" },
  ])(
    "denies non-Manager-service identity %j before touching storage",
    async (user) => {
      const service = new ManagerExecutionService({} as PrismaClient)
      await expect(service.claim({ user, input })).rejects.toThrow("Forbidden")
      await expect(service.complete({ user, input })).rejects.toThrow(
        "Forbidden",
      )
    },
  )

  it.each([
    { operationId: "translate" },
    { operationId: "mastra:unknown" },
    { inputDigest: "not-a-digest" },
    { operationDigest: "a".repeat(63) },
    { runId: "" },
    { jobId: "x".repeat(257) },
    { extra: "ignored-input-is-dangerous" },
  ])(
    "rejects invalid contract fields %j before starting a transaction",
    async (change) => {
      const tx = vi.fn()
      const service = new ManagerExecutionService({
        $transaction: tx,
      } as unknown as PrismaClient)
      await expect(
        service.claim({
          user: MANAGER_BACKEND_PRINCIPAL,
          input: { ...input, ...change },
        }),
      ).rejects.toThrow()
      expect(tx).not.toHaveBeenCalled()
    },
  )

  it.each([
    undefined,
    NaN,
    Infinity,
    new Date(),
    { missing: undefined },
    { fn: () => null },
    { long: "x".repeat(8193) },
    Object.fromEntries([["k".repeat(257), "v"]]),
    new Array(4000),
    Array.from({ length: 4096 }, () => null),
  ])(
    "rejects non-JSON or unbounded completion %j without consuming an outcome",
    async (result) => {
      const tx = vi.fn()
      const service = new ManagerExecutionService({
        $transaction: tx,
      } as unknown as PrismaClient)
      await expect(
        service.complete({
          user: MANAGER_BACKEND_PRINCIPAL,
          input: {
            ...input,
            claimToken: "d7ae866a-5f50-44c6-a07c-6314a07d1a11",
            result,
          },
        }),
      ).rejects.toThrow()
      expect(tx).not.toHaveBeenCalled()
    },
  )
})
