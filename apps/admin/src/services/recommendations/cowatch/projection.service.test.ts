import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { publishCowatchShadowGeneration } from "./projection.service"

describe("retired co-watch publication", () => {
  it("refuses a direct publisher without reading sources or creating a graph", async () => {
    const transaction = vi.fn()
    const db = { $transaction: transaction } as unknown as PrismaClient
    await expect(publishCowatchShadowGeneration(db)).rejects.toThrow("retired")
    expect(transaction).not.toHaveBeenCalled()
  })
})
