import { describe, expect, it } from "vitest"
import { Prisma, type PrismaClient } from "../generated/prisma/index.js"
import {
  PrismaMediaIndexRepository,
  type StoredMediaSignatureInput,
} from "./media-indexing.js"

describe("PrismaMediaIndexRepository signature persistence", () => {
  it("builds one parameterized last-input-wins bulk upsert", async () => {
    const database = new RecordingPrismaClient()
    const repository = new PrismaMediaIndexRepository(database.asClient())
    const injectionMarker = "value'); DROP TABLE mapper_media_signature; --"
    const duplicate = signature({
      coreId: injectionMarker,
      signatureType: "VISUAL_FRAME",
      signature: { kind: "visual", revision: "first" },
    })

    await repository.upsertMediaSignatures([
      duplicate,
      signature({
        signatureType: "AUDIO_FINGERPRINT",
        offsetMilliseconds: 1,
      }),
      signature({ signatureType: "TEXT_SEGMENT", offsetMilliseconds: 2 }),
      signature({ signatureType: "STRUCTURAL_HINT", offsetMilliseconds: 3 }),
      {
        ...duplicate,
        durationMilliseconds: null,
        signature: { kind: "visual", revision: "last" },
        sourceMediaUrl: null,
        sourceMediaHash: null,
      },
    ])

    expect(database.queries).toHaveLength(1)
    const query = database.queries[0]!
    expect(query.text).toContain('INSERT INTO "mapper_media_signature"')
    expect(query.text).toContain("ON CONFLICT")
    expect(query.text).toContain('::"signature_type"')
    expect(query.text).toContain("::jsonb")
    expect(query.text).not.toContain("created_at")
    expect(query.text).not.toContain(injectionMarker)
    expect(query.values).toContain(injectionMarker)
    expect(query.values).toEqual(
      expect.arrayContaining([
        "visual_frame",
        "audio_fingerprint",
        "text_segment",
        "structural_hint",
        JSON.stringify({ kind: "visual", revision: "last" }),
        null,
      ]),
    )
    expect(query.values).not.toContain(
      JSON.stringify({ kind: "visual", revision: "first" }),
    )
    expect(
      query.values.filter(
        (value) =>
          typeof value === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
            value,
          ),
      ),
    ).toHaveLength(4)
  })

  it("does not issue SQL for an empty signature set", async () => {
    const database = new RecordingPrismaClient()
    const repository = new PrismaMediaIndexRepository(database.asClient())

    await repository.upsertMediaSignatures([])

    expect(database.queries).toEqual([])
  })
})

class RecordingPrismaClient {
  readonly queries: Prisma.Sql[] = []

  asClient(): PrismaClient {
    return {
      $executeRaw: async (query: Prisma.Sql) => {
        this.queries.push(query)
        return 1
      },
    } as unknown as PrismaClient
  }
}

function signature(
  overrides: Partial<StoredMediaSignatureInput> = {},
): StoredMediaSignatureInput {
  return {
    coreId: "core-a",
    videoVariantId: "variant-a",
    signatureType: "VISUAL_FRAME",
    algorithmVersion: "official-media-signature-v3",
    offsetMilliseconds: 0,
    durationMilliseconds: 5_000,
    signature: { kind: "visual", revision: "initial" },
    sourceMediaUrl: "https://media.example.com/video.mp4",
    sourceMediaHash: "sha256:sample",
    ...overrides,
  }
}
