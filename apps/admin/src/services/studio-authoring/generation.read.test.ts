import { readFileSync } from "node:fs"
import { beforeEach, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { StudioGenerationService } from "./generation"
import { studioApplySchema, studioProjectSchema } from "@forge/studio-contracts"
import { studioGenerationOutputSchema } from "@forge/studio-contracts/generation"
import { studioHash } from "./state"
import { byteDigest } from "./assets"
import { ForbiddenError, NotFoundError } from "../errors"
import { resolveStudioDocumentSources } from "./sources"

const storage = vi.hoisted(() => ({ bytes: Buffer.alloc(0) }))
vi.mock("@/storage/media", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readMediaObject: vi.fn(async () => storage.bytes),
}))
vi.mock("./sources", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveStudioDocumentSources: vi.fn(async () => []),
}))
const root = new URL(
  "../../../../../docs/validation/studio-458/",
  import.meta.url,
)
const bound = JSON.parse(
  readFileSync(
    new URL("model-comparison-1/verified-bound-proposal.body", root),
    "utf8",
  ),
)
const saved = JSON.parse(
  readFileSync(
    new URL("model-comparison-1/live/retained-0.body", root),
    "utf8",
  ),
).result.previews[0]
const original = JSON.parse(
  readFileSync(
    new URL("effective-speech-feedback/slot0-original-proposal.json", root),
    "utf8",
  ),
)
const base = studioProjectSchema.parse(
  bound.cases.find((c: { case: string }) => c.case === "ch33-seq0-ep2").project,
)
const command = studioApplySchema.parse({
  ...saved.proposal.command,
  operations: original.operations,
})
const human = {
  id: "operator",
  role: "ADMIN",
  studioAuthority: "interactive",
} as const

beforeEach(() => vi.clearAllMocks())
function fixture(commands = [command]) {
  const output = studioGenerationOutputSchema.parse({
    text: "retained output",
    diagnostics: [],
    proposals: commands.map((command, index) => ({
      summary: `Proposal ${index + 1}`,
      command,
    })),
  })
  storage.bytes = Buffer.from(JSON.stringify(output))
  const manifest = {
    assetId: "manifest-asset",
    versionId: "manifest-version",
    digest: byteDigest(storage.bytes),
  }
  const row = {
    number: command.expectedRevision,
    document: structuredClone(base.document),
    actor: base.actor,
  }
  const attempt = {
    id: "read-alias-attempt",
    kind: "GENERATION",
    projectId: command.projectId,
    baseRevision: command.expectedRevision,
    status: "SUCCEEDED",
    result: { manifest },
  }
  // Only storage/read methods exist: unexpected persistence fails this boundary fixture.
  const db = {
    shortAttempt: { findUniqueOrThrow: vi.fn(async () => attempt) },
    shortRevision: { findUnique: vi.fn(async () => row) },
    shortAssetVersion: {
      findFirst: vi.fn(async () => ({
        mediaAsset: {
          status: "READY",
          checksumSha256: manifest.digest,
          objectKey: "fixture/manifest",
          byteSize: storage.bytes.length,
          backend: "LOCAL",
        },
      })),
    },
    $transaction: vi.fn(async (work: (tx: object) => Promise<unknown>) =>
      work({}),
    ),
  }
  const service = new StudioGenerationService(db as unknown as PrismaClient)
  return {
    row,
    output,
    manifest,
    attempt,
    db,
    service,
    read: (proposalIndex = 0) =>
      service.read(human, { attemptId: attempt.id, proposalIndex }),
  }
}

it("preserves the original SSE command digest and whitespace while returning the retained final document", async () => {
  const f = fixture(),
    bytesBefore = Buffer.from(storage.bytes),
    rowBefore = structuredClone(f.row)
  const result = await f.read()
  expect(result.previews[0].document).toEqual(saved.document)
  expect(result.previews[0].proposal.command).toEqual(command)
  expect(studioHash(result.previews[0].proposal.command.operations)).toBe(
    "351ad0cd6eea7b22f0423cc2cda48cd6436daefefd14e2dc1b961f4c4d6fcd7f",
  )
  expect(await f.read()).toEqual(result)
  expect(storage.bytes).toEqual(bytesBefore)
  expect(f.row).toEqual(rowBefore)
})

it("isolates nested inserted items and preserves opposite speech/text ordering across selected repeat reads", async () => {
  const item = saved.document.items.find(
    (item: { kind: string }) => item.kind === "text",
  )
  const insert = {
    ...structuredClone(item),
    id: "inserted",
    startFrame: 0,
    text: "Original display",
    speech: { ...item.speech, text: "  Original speech\n" },
  }
  const common = [
    { kind: "insert-item", item: insert },
    {
      kind: "move-item",
      itemId: "inserted",
      trackId: insert.trackId,
      startFrame: 1,
    },
    {
      kind: "set-timing",
      itemId: "inserted",
      durationInFrames: 2,
      timingLocked: true,
    },
    {
      kind: "set-properties",
      itemId: "inserted",
      properties: { fontSize: 48 },
    },
  ]
  const text = {
    kind: "set-text",
    itemId: "inserted",
    text: "  Final display\n",
  }
  const speech = {
    kind: "set-speech",
    itemId: "inserted",
    speech: { ...insert.speech, text: " Different speech\n " },
  }
  const commands = [
    [speech, text],
    [text, speech],
  ].map((tail, index) =>
    studioApplySchema.parse({
      ...command,
      idempotencyKey: `ordered-${index}`,
      operations: [...common, ...tail],
    }),
  )
  const before = structuredClone(commands),
    f = fixture(commands)
  for (const index of [1, 0, 1, 0]) {
    const result = await f.read(index)
    expect(result.proposalCount).toBe(2)
    expect(result.proposalIndex).toBe(index)
    expect(result.previews).toHaveLength(1)
    expect(result.previews[0].proposal.command).toEqual(before[index])
    expect(
      result.previews[0].document.items.find((i) => i.id === "inserted"),
    ).toMatchObject({
      startFrame: 1,
      durationInFrames: 2,
      timingLocked: true,
      text: text.text,
      properties: { fontSize: 48 },
      speech: { text: index === 0 ? text.text : speech.speech.text },
    })
  }
  expect(commands).toEqual(before)
  expect((await f.read(2)).previews).toEqual([])
})

it("retains authority, manifest digest, project/revision and source rejection", async () => {
  const f = fixture()
  await expect(
    f.service.read(null, { attemptId: f.attempt.id }),
  ).rejects.toBeInstanceOf(ForbiddenError)
  expect(f.db.shortAttempt.findUniqueOrThrow).not.toHaveBeenCalled()
  const bytes = Buffer.from(storage.bytes)
  storage.bytes = Buffer.from("corrupted retained bytes")
  await expect(f.read()).rejects.toMatchObject({ code: "INVALID" })
  storage.bytes = bytes
  for (const key of ["projectId", "baseRevision"] as const) {
    const original = f.attempt[key]
    if (key === "projectId") f.attempt.projectId = "wrong-project"
    else f.attempt.baseRevision += 1
    await expect(f.read()).rejects.toMatchObject({ code: "INVALID" })
    Object.assign(f.attempt, { [key]: original })
  }
  const error = new NotFoundError("Pinned source/range")
  vi.mocked(resolveStudioDocumentSources).mockRejectedValueOnce(error)
  await expect(f.read()).rejects.toBe(error)
  expect(storage.bytes).toEqual(bytes)
})
