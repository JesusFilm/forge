import { describe, expect, it, vi } from "vitest"

import { RagOperationalError } from "../src/contracts/index.js"

import type {
  PromotionReader,
  PromotionStats,
  PromotionTarget,
  PromotionWriter,
} from "./lib/raw-document-promotion.js"
import { runRawDocumentPromotion } from "./promote-raw-documents.js"
import { runRawDocumentPromotionVerification } from "./verify-raw-document-promotion.js"

const emptyStats: PromotionStats = {
  totalRows: 0,
  latestRows: 0,
  pendingRows: 0,
  digest: null,
}

const reader: PromotionReader = {
  stats: async () => ({
    totalRows: 1,
    latestRows: 1,
    pendingRows: 1,
    digest: "0123456789abcdef0123456789abcdef",
  }),
  latestBatch: async () => [],
}

const target: PromotionTarget & PromotionWriter = {
  stats: async () => emptyStats,
  latestBatch: async () => [],
  insertPending: async () => undefined,
  lockForPromotion: async () => undefined,
  atomic: async (operation) => operation(target),
}

describe("raw-document promotion CLI", () => {
  it("wires a dry run and disconnects both stores", async () => {
    const disconnectSource = vi.fn(async () => undefined)
    const disconnectTarget = vi.fn(async () => undefined)
    const write = vi.fn()
    await expect(
      runRawDocumentPromotion(
        ["--source", "starting-with-god"],
        {
          RAG_LOCAL_DATABASE_URL: "postgresql://local:secret@localhost/rag",
          JFRAG_POSTGRESQL_DB_URL: "postgresql://prod:secret@prod.example/rag",
          JFRAG_EXPECTED_POSTGRES_HOST: "prod.example",
        },
        {
          sourceExists: () => true,
          createReader: () => ({ reader, disconnect: disconnectSource }),
          createTarget: () => ({ target, disconnect: disconnectTarget }),
          write,
        },
      ),
    ).resolves.toMatchObject({ dryRun: true, rows: 1 })
    expect(write).toHaveBeenCalledOnce()
    expect(disconnectSource).toHaveBeenCalledOnce()
    expect(disconnectTarget).toHaveBeenCalledOnce()
  })

  it("rejects an unknown source before creating database clients", async () => {
    const createReader = vi.fn()
    await expect(
      runRawDocumentPromotion(
        ["--source", "unknown"],
        {},
        {
          sourceExists: () => false,
          createReader,
          createTarget: vi.fn(),
          write: vi.fn(),
        },
      ),
    ).rejects.toThrow(/unknown source/)
    expect(createReader).not.toHaveBeenCalled()
  })

  it("wires read-only post-promotion verification", async () => {
    const disconnect = vi.fn(async () => undefined)
    const write = vi.fn()
    const verifyingTarget: PromotionReader = {
      ...reader,
      stats: async () => ({
        totalRows: 1,
        latestRows: 1,
        pendingRows: 1,
        digest: "0123456789abcdef0123456789abcdef",
      }),
    }
    await expect(
      runRawDocumentPromotionVerification(
        [
          "--source",
          "starting-with-god",
          "--expected-rows",
          "1",
          "--expected-digest",
          "0123456789abcdef0123456789abcdef",
        ],
        {
          JFRAG_POSTGRESQL_DB_URL: "postgresql://prod:secret@prod.example/rag",
          JFRAG_EXPECTED_POSTGRES_HOST: "prod.example",
        },
        {
          sourceExists: () => true,
          createTarget: () => ({ target: verifyingTarget, disconnect }),
          write,
        },
      ),
    ).resolves.toMatchObject({ status: "committed", mutation: false })
    expect(write).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it("rejects a post-promotion mismatch without writing and disconnects", async () => {
    const disconnect = vi.fn(async () => undefined)
    const write = vi.fn()
    const mismatchedTarget: PromotionReader = {
      ...reader,
      stats: async () => ({
        totalRows: 2,
        latestRows: 2,
        pendingRows: 2,
        digest: "fedcba9876543210fedcba9876543210",
      }),
    }
    const verification = runRawDocumentPromotionVerification(
      [
        "--source",
        "starting-with-god",
        "--expected-rows",
        "1",
        "--expected-digest",
        "0123456789abcdef0123456789abcdef",
      ],
      {
        JFRAG_POSTGRESQL_DB_URL: "postgresql://prod:secret@prod.example/rag",
        JFRAG_EXPECTED_POSTGRES_HOST: "prod.example",
      },
      {
        sourceExists: () => true,
        createTarget: () => ({ target: mismatchedTarget, disconnect }),
        write,
      },
    )

    await expect(verification).rejects.toBeInstanceOf(RagOperationalError)
    await expect(verification).rejects.toMatchObject({
      code: "corpus_state_invalid",
      message:
        "production raw-document state does not match the reviewed promotion pins",
    })
    expect(write).not.toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
