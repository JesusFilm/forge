/**
 * KTD4 — the one path that writes a campaign's copy, destination, and
 * audience: the MCP create, the MCP update, and the dashboard save.
 *
 * A write that really changes the content is one conditional update whose
 * `WHERE` carries the id, an editable status, and the content version the
 * caller read. A count of 0 is the refusal; the read after it only names the
 * refusal. A call that changes nothing writes nothing (R36, KTD7).
 *
 * KTD14 — this module never sends. It imports nothing from the send path, and
 * `campaign.service.ts` imports from here, never the reverse.
 */
import {
  PushCampaignStatus,
  type Prisma,
  type PrismaClient,
  type PushAudienceScope,
  type PushDestinationKind,
} from "@prisma/client"

import {
  parsePushInput,
  PUSH_ENGLISH_REQUIRED_MESSAGE,
  PUSH_MAX_COPY_ROWS,
  PushAudienceInputSchema,
  PushCampaignCreateInputSchema,
  PushCampaignPatchInputSchema,
  PushCampaignUpdateInputSchema,
  pushInputIssues,
  type PushCampaignCreateInput,
  type PushCampaignPatchInput,
  type PushCampaignUpdateInput,
} from "./contracts"
import {
  isPushDestinationPublished,
  readPushDestinationKinds,
} from "./destinations"
import {
  PushFrozenError,
  PushInputError,
  PushNotFoundError,
  PushStaleContentVersionError,
  PushTooManyCopyRowsError,
  PushUnknownDestinationError,
  PushUnknownLanguageError,
  type PushInputIssue,
} from "./errors"
import { PUSH_ENGLISH_LANGUAGE_SLUG } from "./language-resolution"

/** R10 and R17 — copy, destination, and audience still change in these. */
export const PUSH_EDITABLE_STATUSES = [
  PushCampaignStatus.DRAFT,
  PushCampaignStatus.TESTED,
] as const

export function isPushCampaignEditable(status: PushCampaignStatus): boolean {
  return (PUSH_EDITABLE_STATUSES as readonly PushCampaignStatus[]).includes(
    status,
  )
}

export type PushCampaignCopy = Readonly<{
  languageSlug: string
  title: string
  body: string
}>

export type PushCampaignDestination = Readonly<{
  kind: PushDestinationKind
  slug: string
}>

export type PushCampaignAudience = Readonly<{
  scope: PushAudienceScope
  countries: readonly string[]
  languageFilter: readonly string[]
}>

/** KTD6 — the person and the time of the most recent MCP write. */
export type PushCampaignAiMarker = Readonly<{
  actorId: string
  writtenAt: Date
}>

/** The stored content of one campaign. Copy rows are sorted by language. */
export type PushCampaignContentState = Readonly<{
  campaignId: string
  status: PushCampaignStatus
  contentVersion: number
  copies: readonly PushCampaignCopy[]
  destination: PushCampaignDestination | null
  audience: PushCampaignAudience
  lastActorId: string | null
  aiMarker: PushCampaignAiMarker | null
  updatedAt: Date
}>

/** KTD13 — what a write changed, from the stored state before and after it. */
export type PushCampaignContentChanges = Readonly<{
  languages: Readonly<{
    added: readonly string[]
    updated: readonly string[]
    removed: readonly string[]
    unchangedCount: number
  }>
  destination: Readonly<{
    before: PushCampaignDestination | null
    after: PushCampaignDestination | null
  }> | null
  audience: Readonly<{
    before: PushCampaignAudience
    after: PushCampaignAudience
  }> | null
}>

export type PushCampaignContentWriteResult = Readonly<{
  campaignId: string
  /** False when the call changed nothing, so nothing was written. */
  written: boolean
  /** Null for a create. */
  before: PushCampaignContentState | null
  after: PushCampaignContentState
  changed: PushCampaignContentChanges
  statusChange: Readonly<{
    from: PushCampaignStatus
    to: PushCampaignStatus
  }> | null
  /** R13 — whether the destination this call wrote is published; null when it wrote none. */
  destinationPublished: boolean | null
}>

/**
 * The dashboard sends the whole form, so its copy set replaces the stored
 * rows. The agent sends a KTD7 patch. Only the MCP sets the AI marker.
 */
export type PushCampaignContentWrite =
  | Readonly<{
      source: "dashboard"
      campaignId: string
      actorId: string
      expectedContentVersion: number
      update: PushCampaignUpdateInput
    }>
  | Readonly<{
      source: "mcp"
      campaignId: string
      actorId: string
      expectedContentVersion: number
      patch: PushCampaignPatchInput
    }>

const CONTENT_SELECT = {
  id: true,
  status: true,
  contentVersion: true,
  destinationKind: true,
  destinationSlug: true,
  audienceScope: true,
  countries: true,
  languageFilter: true,
  lastActorId: true,
  aiLastActorId: true,
  aiLastWrittenAt: true,
  updatedAt: true,
  copies: {
    orderBy: { languageSlug: "asc" },
    select: { languageSlug: true, title: true, body: true },
  },
} satisfies Prisma.PushCampaignSelect

type ContentRow = Prisma.PushCampaignGetPayload<{
  select: typeof CONTENT_SELECT
}>

const EMPTY_AUDIENCE: PushCampaignAudience = {
  scope: "EVERYWHERE",
  countries: [],
  languageFilter: [],
}

/** What a create is compared with, so every row it writes reads as added. */
const EMPTY_CONTENT = {
  copies: [] as readonly PushCampaignCopy[],
  destination: null,
  audience: EMPTY_AUDIENCE,
}

type Content = Pick<
  PushCampaignContentState,
  "copies" | "destination" | "audience"
>

function bySlug(
  left: { languageSlug: string },
  right: { languageSlug: string },
): number {
  return left.languageSlug < right.languageSlug ? -1 : 1
}

function toState(row: ContentRow): PushCampaignContentState {
  return {
    campaignId: row.id,
    status: row.status,
    contentVersion: row.contentVersion,
    copies: [...row.copies].sort(bySlug),
    destination:
      row.destinationKind && row.destinationSlug
        ? { kind: row.destinationKind, slug: row.destinationSlug }
        : null,
    audience: {
      scope: row.audienceScope,
      countries: row.countries,
      languageFilter: row.languageFilter,
    },
    lastActorId: row.lastActorId,
    aiMarker:
      row.aiLastActorId && row.aiLastWrittenAt
        ? { actorId: row.aiLastActorId, writtenAt: row.aiLastWrittenAt }
        : null,
    updatedAt: row.updatedAt,
  }
}

function sameCopy(left: PushCampaignCopy, right: PushCampaignCopy): boolean {
  return left.title === right.title && left.body === right.body
}

function sameDestination(
  left: PushCampaignDestination | null,
  right: PushCampaignDestination | null,
): boolean {
  return left?.kind === right?.kind && left?.slug === right?.slug
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const set = new Set(left)
  return set.size === new Set(right).size && right.every((v) => set.has(v))
}

/** Order inside the arrays does not change who receives the campaign. */
function sameAudience(
  left: PushCampaignAudience,
  right: PushCampaignAudience,
): boolean {
  return (
    left.scope === right.scope &&
    sameSet(left.countries, right.countries) &&
    sameSet(left.languageFilter, right.languageFilter)
  )
}

function diffContent(
  before: Content,
  after: Content,
): PushCampaignContentChanges {
  const old = new Map(before.copies.map((copy) => [copy.languageSlug, copy]))
  const now = new Map(after.copies.map((copy) => [copy.languageSlug, copy]))
  const added = after.copies
    .filter((copy) => !old.has(copy.languageSlug))
    .map((copy) => copy.languageSlug)
  const updated = after.copies
    .filter((copy) => {
      const stored = old.get(copy.languageSlug)
      return stored !== undefined && !sameCopy(stored, copy)
    })
    .map((copy) => copy.languageSlug)
  const removed = before.copies
    .filter((copy) => !now.has(copy.languageSlug))
    .map((copy) => copy.languageSlug)
  return {
    languages: {
      added,
      updated,
      removed,
      unchangedCount: after.copies.length - added.length - updated.length,
    },
    destination: sameDestination(before.destination, after.destination)
      ? null
      : { before: before.destination, after: after.destination },
    audience: sameAudience(before.audience, after.audience)
      ? null
      : { before: before.audience, after: after.audience },
  }
}

function hasChanges(changes: PushCampaignContentChanges): boolean {
  const { added, updated, removed } = changes.languages
  return (
    added.length + updated.length + removed.length > 0 ||
    changes.destination !== null ||
    changes.audience !== null
  )
}

/** The dashboard's whole-set replace: a part the form omits keeps its value. */
function mergeUpdate(
  stored: PushCampaignContentState,
  update: ReturnType<typeof parseUpdate>,
): Content {
  return {
    copies: update.copies ? [...update.copies].sort(bySlug) : stored.copies,
    destination: update.destination ?? stored.destination,
    audience: update.audience ?? stored.audience,
  }
}

/** KTD7 — the agent's patch: only the named rows and parts change. */
function mergePatch(
  stored: PushCampaignContentState,
  patch: ReturnType<typeof parsePatch>,
): Content {
  const copies = new Map(stored.copies.map((copy) => [copy.languageSlug, copy]))
  for (const slug of patch.removeLanguages ?? []) copies.delete(slug)
  for (const copy of patch.copies ?? []) copies.set(copy.languageSlug, copy)
  return {
    copies: [...copies.values()].sort(bySlug),
    destination: patch.destination ?? stored.destination,
    audience: {
      scope: patch.audience?.scope ?? stored.audience.scope,
      countries: patch.audience?.countries ?? stored.audience.countries,
      languageFilter:
        patch.audience?.languageFilter ?? stored.audience.languageFilter,
    },
  }
}

function parseUpdate(update: PushCampaignUpdateInput) {
  return parsePushInput(PushCampaignUpdateInputSchema, update)
}

function parsePatch(patch: PushCampaignPatchInput) {
  return parsePushInput(PushCampaignPatchInputSchema, patch)
}

/** KTD7 — the merged state must still be a campaign the dashboard accepts. */
function refuseInvalidContent(content: Content): void {
  const issues: PushInputIssue[] = []
  if (
    !content.copies.some(
      (copy) => copy.languageSlug === PUSH_ENGLISH_LANGUAGE_SLUG,
    )
  ) {
    issues.push({ path: "copies", message: PUSH_ENGLISH_REQUIRED_MESSAGE })
  }
  const audience = PushAudienceInputSchema.safeParse(content.audience)
  if (!audience.success) {
    issues.push(...pushInputIssues(audience.error, "audience"))
  }
  if (issues.length > 0) {
    throw new PushInputError(
      issues.map((issue) => issue.message).join("; "),
      issues,
    )
  }
  if (content.copies.length > PUSH_MAX_COPY_ROWS) {
    throw new PushTooManyCopyRowsError(
      content.copies.length,
      PUSH_MAX_COPY_ROWS,
    )
  }
}

/**
 * KTD8 — the slugs a call writes must name a live Language with a slug. A
 * stored slug the call leaves alone is not read, so a row or a filter entry
 * whose language was deleted later never blocks another edit.
 */
function writtenLanguageSlugs(
  before: Content,
  after: Content,
  changes: PushCampaignContentChanges,
): string[] {
  const storedFilter = new Set(before.audience.languageFilter)
  return [
    ...new Set([
      ...changes.languages.added,
      ...changes.languages.updated,
      ...after.audience.languageFilter.filter(
        (slug) => !storedFilter.has(slug),
      ),
    ]),
  ]
}

async function refuseUnknownLanguages(
  prisma: PrismaClient,
  slugs: readonly string[],
): Promise<void> {
  if (slugs.length === 0) return
  const known = await prisma.language.findMany({
    where: { slug: { in: [...slugs] }, deletedAt: null },
    select: { slug: true },
  })
  const knownSlugs = new Set(known.map((row) => row.slug))
  const unknown = slugs.filter((slug) => !knownSlugs.has(slug))
  if (unknown.length > 0) throw new PushUnknownLanguageError(unknown)
}

/**
 * KTD9 — a destination the call writes must exist under its kind. One that
 * exists and is not published still saves (R13); the caller warns.
 */
async function checkWrittenDestination(
  prisma: PrismaClient,
  destination: PushCampaignDestination,
): Promise<boolean> {
  const kinds = await readPushDestinationKinds(prisma, destination.slug)
  if (!kinds.includes(destination.kind)) {
    throw new PushUnknownDestinationError({
      kind: destination.kind,
      slug: destination.slug,
      actualKind: kinds[0] ?? null,
    })
  }
  return isPushDestinationPublished(prisma, destination)
}

async function readContent(
  prisma: Pick<PrismaClient, "pushCampaign">,
  campaignId: string,
): Promise<PushCampaignContentState | null> {
  const row = await prisma.pushCampaign.findUnique({
    where: { id: campaignId },
    select: CONTENT_SELECT,
  })
  return row ? toState(row) : null
}

/** The conditional update moved no row; the current row names the reason. */
async function refuseLostWrite(
  prisma: Pick<PrismaClient, "pushCampaign">,
  campaignId: string,
): Promise<never> {
  const current = await readContent(prisma, campaignId)
  if (current === null) throw campaignNotFound()
  if (!isPushCampaignEditable(current.status)) {
    throw new PushFrozenError(current.status)
  }
  throw new PushStaleContentVersionError({
    currentContentVersion: current.contentVersion,
    lastActorId: current.lastActorId,
    updatedAt: current.updatedAt,
  })
}

function campaignNotFound(): PushNotFoundError {
  return new PushNotFoundError("That campaign does not exist")
}

/**
 * R3, R10, R11, R17, R33, R34, R36 — writes the content of an existing
 * campaign as one person, through the dashboard or the MCP.
 *
 * The status check comes before any comparison, so a frozen campaign is
 * refused even when the call would change nothing. A real change moves the
 * campaign to DRAFT and raises its version by one.
 */
export async function writePushCampaignContent(
  prisma: PrismaClient,
  input: PushCampaignContentWrite,
): Promise<PushCampaignContentWriteResult> {
  const parsed =
    input.source === "dashboard"
      ? { source: input.source, update: parseUpdate(input.update) }
      : { source: input.source, patch: parsePatch(input.patch) }

  const before = await readContent(prisma, input.campaignId)
  if (before === null) throw campaignNotFound()
  if (!isPushCampaignEditable(before.status)) {
    throw new PushFrozenError(before.status)
  }

  const candidate =
    parsed.source === "dashboard"
      ? mergeUpdate(before, parsed.update)
      : mergePatch(before, parsed.patch)
  // A reordered audience is not a change, so the stored order is kept.
  const merged: Content = sameAudience(before.audience, candidate.audience)
    ? { ...candidate, audience: before.audience }
    : candidate
  refuseInvalidContent(merged)

  const planned = diffContent(before, merged)
  if (!hasChanges(planned)) {
    return {
      campaignId: before.campaignId,
      written: false,
      before,
      after: before,
      changed: planned,
      statusChange: null,
      destinationPublished: null,
    }
  }

  await refuseUnknownLanguages(
    prisma,
    writtenLanguageSlugs(before, merged, planned),
  )
  const destinationPublished =
    planned.destination && merged.destination
      ? await checkWrittenDestination(prisma, merged.destination)
      : null

  const added = new Set(planned.languages.added)
  const updated = new Set(planned.languages.updated)
  const writtenAt = new Date()

  const after = await prisma.$transaction(async (tx) => {
    const { count } = await tx.pushCampaign.updateMany({
      where: {
        id: input.campaignId,
        status: { in: [...PUSH_EDITABLE_STATUSES] },
        contentVersion: input.expectedContentVersion,
      },
      data: {
        contentVersion: { increment: 1 },
        status: PushCampaignStatus.DRAFT,
        lastActorId: input.actorId,
        destinationKind: merged.destination?.kind ?? null,
        destinationSlug: merged.destination?.slug ?? null,
        audienceScope: merged.audience.scope,
        countries: [...merged.audience.countries],
        languageFilter: [...merged.audience.languageFilter],
        ...(input.source === "mcp"
          ? { aiLastActorId: input.actorId, aiLastWrittenAt: writtenAt }
          : {}),
      },
    })
    if (count !== 1) await refuseLostWrite(tx, input.campaignId)

    // AE2 — only rows that really change are written, so the rest keep
    // their ids and `updatedAt`.
    const created = merged.copies.filter((copy) => added.has(copy.languageSlug))
    if (created.length > 0) {
      await tx.pushCampaignCopy.createMany({
        data: created.map((copy) => ({
          campaignId: input.campaignId,
          languageSlug: copy.languageSlug,
          title: copy.title,
          body: copy.body,
        })),
      })
    }
    for (const copy of merged.copies) {
      if (!updated.has(copy.languageSlug)) continue
      await tx.pushCampaignCopy.update({
        where: {
          campaignId_languageSlug: {
            campaignId: input.campaignId,
            languageSlug: copy.languageSlug,
          },
        },
        data: { title: copy.title, body: copy.body },
      })
    }
    if (planned.languages.removed.length > 0) {
      await tx.pushCampaignCopy.deleteMany({
        where: {
          campaignId: input.campaignId,
          languageSlug: { in: [...planned.languages.removed] },
        },
      })
    }

    const written = await readContent(tx, input.campaignId)
    if (written === null) throw campaignNotFound()
    return written
  })

  return {
    campaignId: after.campaignId,
    written: true,
    before,
    after,
    changed: diffContent(before, after),
    statusChange:
      before.status === after.status
        ? null
        : { from: before.status, to: after.status },
    destinationPublished,
  }
}

/**
 * R9 — the agent's create: a DRAFT at version 1 that carries at least the
 * English copy, with the AI marker set. Every check runs before the one
 * nested create, so a refusal saves nothing (AE3).
 */
export async function createPushCampaignContent(
  prisma: PrismaClient,
  input: { actorId: string; content: PushCampaignCreateInput },
): Promise<PushCampaignContentWriteResult> {
  const content = parsePushInput(PushCampaignCreateInputSchema, input.content)
  const copies = [...content.copies].sort(bySlug)
  const audience = content.audience ?? EMPTY_AUDIENCE

  await refuseUnknownLanguages(prisma, [
    ...new Set([
      ...copies.map((copy) => copy.languageSlug),
      ...audience.languageFilter,
    ]),
  ])
  const destinationPublished = content.destination
    ? await checkWrittenDestination(prisma, content.destination)
    : null

  const row = await prisma.pushCampaign.create({
    data: {
      status: PushCampaignStatus.DRAFT,
      contentVersion: 1,
      lastActorId: input.actorId,
      aiLastActorId: input.actorId,
      aiLastWrittenAt: new Date(),
      destinationKind: content.destination?.kind ?? null,
      destinationSlug: content.destination?.slug ?? null,
      audienceScope: audience.scope,
      countries: [...audience.countries],
      languageFilter: [...audience.languageFilter],
      copies: { createMany: { data: copies } },
    },
    select: CONTENT_SELECT,
  })

  const after = toState(row)
  return {
    campaignId: after.campaignId,
    written: true,
    before: null,
    after,
    changed: diffContent(EMPTY_CONTENT, after),
    statusChange: null,
    destinationPublished,
  }
}
