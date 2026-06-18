#!/usr/bin/env tsx

import { createHash, randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { Prisma, PrismaClient } from "@prisma/client"
import { z } from "zod"

import { assertParallelArrayLengthsMatch, toPgArray } from "@/db/pgvector"
import { coreQuery } from "@/services/core-sync/core-client"
import {
  acquireSyncLock,
  refreshSyncLock,
  releaseSyncLock,
} from "@/services/core-sync/lock"
import { withPrismaPoolTimeoutRetry } from "@/services/core-sync/pool-timeout-retry"
import { CORE_SYNC_TRANSACTION_OPTIONS } from "@/services/core-sync/transaction-options"

const DEFAULT_BATCH_SIZE = 10
const DEFAULT_UPDATE_BATCH_SIZE = 250
const LOCK_HEARTBEAT_INTERVAL_MS = 60_000
const EXPECTED_JESUS_FIRST_CHILD_SLUGS = [
  "the-beginning",
  "birth-of-jesus",
  "childhood-of-jesus",
]

const RELATION_ORDER_QUERY = `
  query VideoRelationOrders($offset: Int!, $limit: Int!, $where: VideosFilter) {
    videos(offset: $offset, limit: $limit, where: $where) {
      id
      slug
      children {
        id
        slug
      }
    }
  }
`

const CoreVideoRelationOrderSchema = z.object({
  id: z.string(),
  slug: z.string().nullable().optional(),
  children: z
    .array(
      z.object({
        id: z.string(),
        slug: z.string().nullable().optional(),
      }),
    )
    .optional()
    .default([]),
})

const CoreVideoRelationOrderListSchema = z.array(CoreVideoRelationOrderSchema)

type CoreVideoRelationOrder = z.infer<typeof CoreVideoRelationOrderSchema>

type AdminVideoTarget = {
  id: string
  coreId: string
  slug: string
}

type AdminChildVideo = {
  id: string
  coreId: string
  slug: string
}

type ExistingVideoRelation = {
  id: string
  parentId: string
  childId: string
  order: number | null
  child?: {
    coreId: string
    slug: string
  }
}

export type BackfillVideoRelationOrderArgs = {
  slug?: string
  coreId?: string
  limit?: number
  fullCatalog: boolean
  execute: boolean
  verbose: boolean
  batchSize: number
  allowMissingTopology: boolean
  confirmDatabase?: string
  reportOut?: string
  transactionTimeoutMs?: number
}

export type DatabaseIdentity = {
  hash: string
  redactedUrl: string
}

export type PlannedRelationOrderChange = {
  relationId: string
  parentId: string
  parentCoreId: string
  parentSlug: string
  childId: string
  childCoreId: string
  childSlug: string
  corePosition: number
  oldOrder: number | null
  newOrder: number
}

export type MissingCoreParent = {
  parentId: string
  parentCoreId: string
  parentSlug: string
}

export type MissingAdminChild = {
  parentId: string
  parentCoreId: string
  parentSlug: string
  childCoreId: string
  childSlug: string | null
  corePosition: number
}

export type MissingVideoRelation = MissingAdminChild & {
  childId: string
  childSlug: string
}

export type DuplicateCoreChild = {
  parentId: string
  parentCoreId: string
  parentSlug: string
  childCoreId: string
  firstCorePosition: number
  duplicateCorePosition: number
}

export type ExtraAdminRelation = {
  relationId: string
  parentId: string
  parentCoreId: string
  parentSlug: string
  childId: string
  childCoreId: string
  childSlug: string
  oldOrder: number | null
}

export type ParentCoreChildPreview = {
  parentId: string
  parentCoreId: string
  parentSlug: string
  coreSlug: string | null
  firstCoreChildSlugs: string[]
}

export type JesusFirstThreeCheck = {
  expected: string[]
  actual: string[]
  mismatch: boolean
}

export type RelationOrderPlan = {
  selectedParents: AdminVideoTarget[]
  fetchedCoreParents: number
  changes: PlannedRelationOrderChange[]
  unchangedCount: number
  missingCoreParents: MissingCoreParent[]
  missingAdminChildren: MissingAdminChild[]
  missingRelations: MissingVideoRelation[]
  duplicateCoreChildren: DuplicateCoreChild[]
  extraAdminRelations: ExtraAdminRelation[]
  firstCoreChildSlugsByParent: ParentCoreChildPreview[]
  jesusFirstThree?: JesusFirstThreeCheck
}

export type BackfillVideoRelationOrderProgress = {
  phase: "plan" | "update"
  batch: number
  batches: number
  batchSize: number
  selected: number
  selectedProcessed: number
  fetchedCoreParents: number
  missingCoreParents: number
  planned: number
  updated: number
  unchanged: number
  missingChild: number
  missingRelation: number
  duplicateCoreChildren: number
  extraAdminRelation: number
  errors: number
}

export type BackfillVideoRelationOrderSummary = {
  dryRun: boolean
  runId: string
  reportPath: string
  selected: number
  fetchedCoreParents: number
  planned: number
  updated: number
  unchanged: number
  missingCoreParents: number
  missingChild: number
  missingRelation: number
  duplicateCoreChildren: number
  extraAdminRelation: number
  errors: number
  databaseIdentityHash?: string
  firstCoreChildSlugsByParent: ParentCoreChildPreview[]
  jesusFirstThree?: JesusFirstThreeCheck
}

export type VideoRelationOrderBackfillReport = {
  runId: string
  generatedAt: string
  dryRun: boolean
  execute: boolean
  databaseIdentityHash?: string
  args: Omit<BackfillVideoRelationOrderArgs, "confirmDatabase">
  summary: Omit<
    BackfillVideoRelationOrderSummary,
    "firstCoreChildSlugsByParent" | "jesusFirstThree"
  >
  selectedParents: AdminVideoTarget[]
  firstCoreChildSlugsByParent: ParentCoreChildPreview[]
  jesusFirstThree?: JesusFirstThreeCheck
  changes: PlannedRelationOrderChange[]
  missingCoreParents: MissingCoreParent[]
  missingAdminChildren: MissingAdminChild[]
  missingRelations: MissingVideoRelation[]
  duplicateCoreChildren: DuplicateCoreChild[]
  extraAdminRelations: ExtraAdminRelation[]
  rollbackSql: string
}

type RelationOrderPrisma = Pick<
  PrismaClient,
  "video" | "videoRelation" | "$transaction"
>

type TransactionPrisma = Pick<Prisma.TransactionClient, "$executeRaw">

type LockApi = {
  acquireSyncLock: typeof acquireSyncLock
  refreshSyncLock: typeof refreshSyncLock
  releaseSyncLock: typeof releaseSyncLock
}

type Logger = (event: Record<string, unknown>) => void

export class RelationOrderBackfillError extends Error {
  readonly summary: BackfillVideoRelationOrderSummary

  constructor(message: string, summary: BackfillVideoRelationOrderSummary) {
    super(message)
    this.name = "RelationOrderBackfillError"
    this.summary = summary
  }
}

export function parseArgs(
  argv: readonly string[],
): BackfillVideoRelationOrderArgs {
  const valueFor = (name: string): string | undefined => {
    const prefix = `--${name}=`
    return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  }
  const intFor = (name: string): number | undefined => {
    const raw = valueFor(name)
    if (!raw) return undefined
    if (!/^[0-9]+$/.test(raw)) {
      throw new Error(`--${name} must be a positive integer`)
    }
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`--${name} must be a positive integer`)
    }
    return parsed
  }

  return {
    slug: valueFor("slug"),
    coreId: valueFor("core-id"),
    limit: intFor("limit"),
    fullCatalog: argv.includes("--full-catalog"),
    execute: argv.includes("--execute"),
    verbose: argv.includes("--verbose"),
    batchSize: intFor("batch-size") ?? DEFAULT_BATCH_SIZE,
    allowMissingTopology: argv.includes("--allow-missing-topology"),
    confirmDatabase: valueFor("confirm-database"),
    reportOut: valueFor("report-out"),
    transactionTimeoutMs: intFor("transaction-timeout-ms"),
  }
}

export function validateArgs(args: BackfillVideoRelationOrderArgs): void {
  if (!args.fullCatalog && !args.slug && !args.coreId && !args.limit) {
    throw new Error(
      "Refusing broad relation-order backfill: pass --slug, --core-id, --limit, or --full-catalog.",
    )
  }
}

export function databaseIdentityForUrl(databaseUrl: string): DatabaseIdentity {
  const url = new URL(databaseUrl)
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !/(password|secret|token|key)/i.test(key))
    .sort(([left], [right]) => left.localeCompare(right))
  const databaseName = url.pathname.replace(/^\/+/, "")
  const identity = JSON.stringify({
    protocol: url.protocol,
    username: url.username,
    host: url.hostname,
    port: url.port,
    database: databaseName,
    params,
  })
  return {
    hash: createHash("sha256").update(identity).digest("hex").slice(0, 16),
    redactedUrl: redactDatabaseUrl(databaseUrl),
  }
}

function redactDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  if (url.username || url.password) {
    url.username = "***"
    url.password = "***"
  }
  for (const key of [...url.searchParams.keys()]) {
    if (/(password|secret|token|key)/i.test(key)) {
      url.searchParams.set(key, "***")
    }
  }
  return url.toString()
}

export function resolveReportPath(
  args: Pick<BackfillVideoRelationOrderArgs, "reportOut">,
  runId: string,
  cwd = process.cwd(),
): string {
  return args.reportOut
    ? resolve(cwd, args.reportOut)
    : resolve(cwd, ".tmp", "video-relation-order-backfill", `${runId}.json`)
}

export async function selectAdminParentVideos(
  prisma: Pick<PrismaClient, "video">,
  args: BackfillVideoRelationOrderArgs,
): Promise<AdminVideoTarget[]> {
  const explicitTarget = args.slug != null || args.coreId != null
  return prisma.video.findMany({
    where: {
      source: "CORE",
      deletedAt: null,
      ...(args.slug ? { slug: args.slug } : {}),
      ...(args.coreId ? { coreId: args.coreId } : {}),
      ...(explicitTarget ? {} : { children: { some: {} } }),
    },
    select: { id: true, coreId: true, slug: true },
    orderBy: { updatedAt: "desc" },
    take: args.fullCatalog ? undefined : (args.limit ?? 1),
  })
}

async function fetchCoreRelationOrders(
  coreIds: readonly string[],
): Promise<CoreVideoRelationOrder[]> {
  if (coreIds.length === 0) return []
  const result = await coreQuery<{ videos: unknown[] }>(RELATION_ORDER_QUERY, {
    offset: 0,
    limit: coreIds.length,
    where: {
      published: true,
      ids: [...coreIds],
    },
  })
  return CoreVideoRelationOrderListSchema.parse(result.data?.videos ?? [])
}

function mergePlan(target: RelationOrderPlan, source: RelationOrderPlan): void {
  target.fetchedCoreParents += source.fetchedCoreParents
  target.changes.push(...source.changes)
  target.unchangedCount += source.unchangedCount
  target.missingCoreParents.push(...source.missingCoreParents)
  target.missingAdminChildren.push(...source.missingAdminChildren)
  target.missingRelations.push(...source.missingRelations)
  target.duplicateCoreChildren.push(...source.duplicateCoreChildren)
  target.extraAdminRelations.push(...source.extraAdminRelations)
  target.firstCoreChildSlugsByParent.push(...source.firstCoreChildSlugsByParent)
  if (source.jesusFirstThree != null) {
    target.jesusFirstThree = source.jesusFirstThree
  }
}

function emptyPlan(selectedParents: AdminVideoTarget[]): RelationOrderPlan {
  return {
    selectedParents,
    fetchedCoreParents: 0,
    changes: [],
    unchangedCount: 0,
    missingCoreParents: [],
    missingAdminChildren: [],
    missingRelations: [],
    duplicateCoreChildren: [],
    extraAdminRelations: [],
    firstCoreChildSlugsByParent: [],
  }
}

function relationKey(parentId: string, childId: string): string {
  return `${parentId}\0${childId}`
}

function firstChildPreview(
  parent: AdminVideoTarget,
  coreVideo: CoreVideoRelationOrder,
): ParentCoreChildPreview {
  return {
    parentId: parent.id,
    parentCoreId: parent.coreId,
    parentSlug: parent.slug,
    coreSlug: coreVideo.slug ?? null,
    firstCoreChildSlugs: coreVideo.children
      .slice(0, 5)
      .map((child) => child.slug ?? child.id),
  }
}

function isJesusParent(
  parent: AdminVideoTarget,
  coreVideo: CoreVideoRelationOrder,
): boolean {
  return (
    parent.slug === "jesus" ||
    parent.coreId === "1_jf-0-0" ||
    coreVideo.slug === "jesus"
  )
}

function compareJesusFirstThree(
  coreVideo: CoreVideoRelationOrder,
): JesusFirstThreeCheck {
  const actual = coreVideo.children
    .slice(0, EXPECTED_JESUS_FIRST_CHILD_SLUGS.length)
    .map((child) => child.slug ?? child.id)
  return {
    expected: [...EXPECTED_JESUS_FIRST_CHILD_SLUGS],
    actual,
    mismatch: EXPECTED_JESUS_FIRST_CHILD_SLUGS.some(
      (expected, index) => actual[index] !== expected,
    ),
  }
}

export function buildRelationOrderPlan({
  selectedParents,
  coreVideos,
  adminChildren,
  existingRelations,
}: {
  selectedParents: readonly AdminVideoTarget[]
  coreVideos: readonly CoreVideoRelationOrder[]
  adminChildren: readonly AdminChildVideo[]
  existingRelations: readonly ExistingVideoRelation[]
}): RelationOrderPlan {
  const plan = emptyPlan([...selectedParents])
  const coreVideoById = new Map(coreVideos.map((video) => [video.id, video]))
  const childByCoreId = new Map(
    adminChildren.map((child) => [child.coreId, child]),
  )
  const relationByParentAndChild = new Map(
    existingRelations.map((relation) => [
      relationKey(relation.parentId, relation.childId),
      relation,
    ]),
  )
  const parentById = new Map(
    selectedParents.map((parent) => [parent.id, parent]),
  )
  const coreChildIdsByParentCoreId = new Map<string, Set<string>>()

  plan.fetchedCoreParents = coreVideos.length

  for (const parent of selectedParents) {
    const coreVideo = coreVideoById.get(parent.coreId)
    if (!coreVideo) {
      plan.missingCoreParents.push({
        parentId: parent.id,
        parentCoreId: parent.coreId,
        parentSlug: parent.slug,
      })
      continue
    }

    plan.firstCoreChildSlugsByParent.push(firstChildPreview(parent, coreVideo))
    if (isJesusParent(parent, coreVideo)) {
      plan.jesusFirstThree = compareJesusFirstThree(coreVideo)
    }
    coreChildIdsByParentCoreId.set(
      parent.coreId,
      new Set(coreVideo.children.map((child) => child.id)),
    )

    const firstCorePositionByChildCoreId = new Map<string, number>()
    for (const [index, child] of coreVideo.children.entries()) {
      const corePosition = index + 1
      const firstCorePosition = firstCorePositionByChildCoreId.get(child.id)
      if (firstCorePosition != null) {
        plan.duplicateCoreChildren.push({
          parentId: parent.id,
          parentCoreId: parent.coreId,
          parentSlug: parent.slug,
          childCoreId: child.id,
          firstCorePosition,
          duplicateCorePosition: corePosition,
        })
        continue
      }
      firstCorePositionByChildCoreId.set(child.id, corePosition)

      const adminChild = childByCoreId.get(child.id)
      if (!adminChild) {
        plan.missingAdminChildren.push({
          parentId: parent.id,
          parentCoreId: parent.coreId,
          parentSlug: parent.slug,
          childCoreId: child.id,
          childSlug: child.slug ?? null,
          corePosition,
        })
        continue
      }

      const relation = relationByParentAndChild.get(
        relationKey(parent.id, adminChild.id),
      )
      if (!relation) {
        plan.missingRelations.push({
          parentId: parent.id,
          parentCoreId: parent.coreId,
          parentSlug: parent.slug,
          childCoreId: child.id,
          childId: adminChild.id,
          childSlug: adminChild.slug,
          corePosition,
        })
        continue
      }

      const row = {
        relationId: relation.id,
        parentId: parent.id,
        parentCoreId: parent.coreId,
        parentSlug: parent.slug,
        childId: adminChild.id,
        childCoreId: child.id,
        childSlug: adminChild.slug,
        corePosition,
        oldOrder: relation.order,
        newOrder: corePosition,
      }
      if (relation.order === corePosition) {
        plan.unchangedCount++
      } else {
        plan.changes.push(row)
      }
    }
  }

  for (const relation of existingRelations) {
    const parent = parentById.get(relation.parentId)
    if (!parent || !relation.child) continue
    const coreChildIds = coreChildIdsByParentCoreId.get(parent.coreId)
    if (!coreChildIds || coreChildIds.has(relation.child.coreId)) continue
    plan.extraAdminRelations.push({
      relationId: relation.id,
      parentId: parent.id,
      parentCoreId: parent.coreId,
      parentSlug: parent.slug,
      childId: relation.childId,
      childCoreId: relation.child.coreId,
      childSlug: relation.child.slug,
      oldOrder: relation.order,
    })
  }

  return plan
}

async function resolveBatchPlan(
  prisma: RelationOrderPrisma,
  selectedParents: readonly AdminVideoTarget[],
): Promise<RelationOrderPlan> {
  const coreVideos = await fetchCoreRelationOrders(
    selectedParents.map((video) => video.coreId),
  )
  const childCoreIds = [
    ...new Set(
      coreVideos.flatMap((video) => video.children.map((child) => child.id)),
    ),
  ]
  const adminChildren =
    childCoreIds.length > 0
      ? await prisma.video.findMany({
          where: { coreId: { in: childCoreIds }, deletedAt: null },
          select: { id: true, coreId: true, slug: true },
        })
      : []
  const existingRelations =
    selectedParents.length > 0
      ? await prisma.videoRelation.findMany({
          where: {
            parentId: { in: selectedParents.map((parent) => parent.id) },
          },
          select: {
            id: true,
            parentId: true,
            childId: true,
            order: true,
            child: { select: { coreId: true, slug: true } },
          },
        })
      : []

  return buildRelationOrderPlan({
    selectedParents,
    coreVideos,
    adminChildren,
    existingRelations,
  })
}

function topologyErrorCount(plan: RelationOrderPlan): number {
  return (
    plan.missingCoreParents.length +
    plan.missingAdminChildren.length +
    plan.missingRelations.length +
    plan.duplicateCoreChildren.length +
    plan.extraAdminRelations.length
  )
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function buildRollbackSql(
  changes: readonly PlannedRelationOrderChange[],
): string {
  return changes
    .flatMap((change) => {
      const orderValue =
        change.oldOrder == null ? "NULL" : String(change.oldOrder)
      return [
        `UPDATE "video_relation"`,
        `SET "order" = ${orderValue}`,
        `WHERE "id" = ${sqlString(change.relationId)}`,
        `  AND "order" IS NOT DISTINCT FROM ${change.newOrder};`,
      ].join("\n")
    })
    .join("\n\n")
}

function buildSummary({
  args,
  runId,
  reportPath,
  databaseIdentityHash,
  plan,
  updated,
  errors,
}: {
  args: BackfillVideoRelationOrderArgs
  runId: string
  reportPath: string
  databaseIdentityHash?: string
  plan: RelationOrderPlan
  updated: number
  errors: number
}): BackfillVideoRelationOrderSummary {
  return {
    dryRun: !args.execute,
    runId,
    reportPath,
    selected: plan.selectedParents.length,
    fetchedCoreParents: plan.fetchedCoreParents,
    planned: plan.changes.length,
    updated,
    unchanged: plan.unchangedCount,
    missingCoreParents: plan.missingCoreParents.length,
    missingChild: plan.missingAdminChildren.length,
    missingRelation: plan.missingRelations.length,
    duplicateCoreChildren: plan.duplicateCoreChildren.length,
    extraAdminRelation: plan.extraAdminRelations.length,
    errors,
    databaseIdentityHash,
    firstCoreChildSlugsByParent: plan.firstCoreChildSlugsByParent,
    jesusFirstThree: plan.jesusFirstThree,
  }
}

function buildReport({
  args,
  runId,
  databaseIdentityHash,
  plan,
  summary,
}: {
  args: BackfillVideoRelationOrderArgs
  runId: string
  databaseIdentityHash?: string
  plan: RelationOrderPlan
  summary: BackfillVideoRelationOrderSummary
}): VideoRelationOrderBackfillReport {
  const safeArgs: Omit<BackfillVideoRelationOrderArgs, "confirmDatabase"> = {
    slug: args.slug,
    coreId: args.coreId,
    limit: args.limit,
    fullCatalog: args.fullCatalog,
    execute: args.execute,
    verbose: args.verbose,
    batchSize: args.batchSize,
    allowMissingTopology: args.allowMissingTopology,
    reportOut: args.reportOut,
    transactionTimeoutMs: args.transactionTimeoutMs,
  }
  const reportSummary: Omit<
    BackfillVideoRelationOrderSummary,
    "firstCoreChildSlugsByParent" | "jesusFirstThree"
  > = {
    dryRun: summary.dryRun,
    runId: summary.runId,
    reportPath: summary.reportPath,
    selected: summary.selected,
    fetchedCoreParents: summary.fetchedCoreParents,
    planned: summary.planned,
    updated: summary.updated,
    unchanged: summary.unchanged,
    missingCoreParents: summary.missingCoreParents,
    missingChild: summary.missingChild,
    missingRelation: summary.missingRelation,
    duplicateCoreChildren: summary.duplicateCoreChildren,
    extraAdminRelation: summary.extraAdminRelation,
    errors: summary.errors,
    databaseIdentityHash: summary.databaseIdentityHash,
  }
  return {
    runId,
    generatedAt: new Date().toISOString(),
    dryRun: !args.execute,
    execute: args.execute,
    databaseIdentityHash,
    args: safeArgs,
    summary: reportSummary,
    selectedParents: plan.selectedParents,
    firstCoreChildSlugsByParent: plan.firstCoreChildSlugsByParent,
    jesusFirstThree: plan.jesusFirstThree,
    changes: plan.changes,
    missingCoreParents: plan.missingCoreParents,
    missingAdminChildren: plan.missingAdminChildren,
    missingRelations: plan.missingRelations,
    duplicateCoreChildren: plan.duplicateCoreChildren,
    extraAdminRelations: plan.extraAdminRelations,
    rollbackSql: buildRollbackSql(plan.changes),
  }
}

async function writeJsonReport(
  report: VideoRelationOrderBackfillReport,
  reportPath: string,
): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
}

export async function updateRelationOrders(
  tx: TransactionPrisma,
  changes: readonly PlannedRelationOrderChange[],
): Promise<number> {
  if (changes.length === 0) return 0
  const relationIds = changes.map((change) => change.relationId)
  const orders = changes.map((change) => change.newOrder.toString())
  const oldOrders = changes.map((change) => change.oldOrder?.toString() ?? null)

  assertParallelArrayLengthsMatch(
    changes.length,
    [
      { name: "relationIds", length: relationIds.length },
      { name: "orders", length: orders.length },
      { name: "oldOrders", length: oldOrders.length },
    ],
    (message) =>
      new Error(
        message.replace("bulk INSERT", "video relation order bulk UPDATE"),
      ),
  )

  return tx.$executeRaw`
    UPDATE "video_relation" AS relation
    SET "order" = input."order_text"::int
    FROM unnest(
      ${toPgArray(relationIds)}::text[],
      ${toPgArray(orders)}::text[],
      ${toPgArray(oldOrders)}::text[]
    ) AS input("id", "order_text", "old_order_text")
    WHERE relation."id" = input."id"
      AND relation."order" IS NOT DISTINCT FROM input."old_order_text"::int
      AND relation."order" IS DISTINCT FROM input."order_text"::int
  `
}

function progressFromPlan({
  phase,
  batch,
  batches,
  batchSize,
  selected,
  selectedProcessed,
  plan,
  updated,
  errors,
}: {
  phase: "plan" | "update"
  batch: number
  batches: number
  batchSize: number
  selected: number
  selectedProcessed: number
  plan: RelationOrderPlan
  updated: number
  errors: number
}): BackfillVideoRelationOrderProgress {
  return {
    phase,
    batch,
    batches,
    batchSize,
    selected,
    selectedProcessed,
    fetchedCoreParents: plan.fetchedCoreParents,
    missingCoreParents: plan.missingCoreParents.length,
    planned: plan.changes.length,
    updated,
    unchanged: plan.unchangedCount,
    missingChild: plan.missingAdminChildren.length,
    missingRelation: plan.missingRelations.length,
    duplicateCoreChildren: plan.duplicateCoreChildren.length,
    extraAdminRelation: plan.extraAdminRelations.length,
    errors,
  }
}

export async function runBackfill(
  prisma: RelationOrderPrisma,
  args: BackfillVideoRelationOrderArgs,
  options: {
    assertLockActive?: () => Promise<void>
    onProgress?: (progress: BackfillVideoRelationOrderProgress) => void
    onPoolRetry?: Parameters<typeof withPrismaPoolTimeoutRetry>[1]["onRetry"]
    sleep?: Parameters<typeof withPrismaPoolTimeoutRetry>[1]["sleep"]
    writeReport?: (
      report: VideoRelationOrderBackfillReport,
      reportPath: string,
    ) => Promise<void>
    runId?: string
    reportPath?: string
    databaseIdentityHash?: string
  } = {},
): Promise<BackfillVideoRelationOrderSummary> {
  validateArgs(args)
  const runId = options.runId ?? `video-relation-order-backfill-${randomUUID()}`
  const reportPath = options.reportPath ?? resolveReportPath(args, runId)
  const writeReport = options.writeReport ?? writeJsonReport

  await options.assertLockActive?.()
  const selectedParents = await selectAdminParentVideos(prisma, args)
  const plan = emptyPlan(selectedParents)
  const explicitTarget = args.slug != null || args.coreId != null
  if (explicitTarget && selectedParents.length === 0) {
    const summary = buildSummary({
      args,
      runId,
      reportPath,
      databaseIdentityHash: options.databaseIdentityHash,
      plan,
      updated: 0,
      errors: 1,
    })
    await writeReport(
      buildReport({
        args,
        runId,
        databaseIdentityHash: options.databaseIdentityHash,
        plan,
        summary,
      }),
      reportPath,
    )
    throw new RelationOrderBackfillError(
      "Explicit relation-order backfill target did not match an Admin video.",
      summary,
    )
  }
  const batches =
    selectedParents.length === 0
      ? 0
      : Math.ceil(selectedParents.length / args.batchSize)

  for (let index = 0; index < selectedParents.length; index += args.batchSize) {
    await options.assertLockActive?.()
    const batch = selectedParents.slice(index, index + args.batchSize)
    const batchPlan = await resolveBatchPlan(prisma, batch)
    mergePlan(plan, batchPlan)
    options.onProgress?.(
      progressFromPlan({
        phase: "plan",
        batch: Math.floor(index / args.batchSize) + 1,
        batches,
        batchSize: args.batchSize,
        selected: selectedParents.length,
        selectedProcessed: Math.min(
          index + batch.length,
          selectedParents.length,
        ),
        plan,
        updated: 0,
        errors: topologyErrorCount(plan),
      }),
    )
    await options.assertLockActive?.()
  }

  const errors = topologyErrorCount(plan)
  let summary = buildSummary({
    args,
    runId,
    reportPath,
    databaseIdentityHash: options.databaseIdentityHash,
    plan,
    updated: 0,
    errors,
  })
  await writeReport(
    buildReport({
      args,
      runId,
      databaseIdentityHash: options.databaseIdentityHash,
      plan,
      summary,
    }),
    reportPath,
  )

  if (args.execute && errors > 0 && !args.allowMissingTopology) {
    throw new RelationOrderBackfillError(
      [
        "Refusing to execute relation-order backfill with missing topology.",
        `missingCoreParents=${plan.missingCoreParents.length}`,
        `missingAdminChildren=${plan.missingAdminChildren.length}`,
        `missingRelations=${plan.missingRelations.length}`,
        `duplicateCoreChildren=${plan.duplicateCoreChildren.length}`,
        `extraAdminRelations=${plan.extraAdminRelations.length}`,
        "Pass --allow-missing-topology only after reviewing the report.",
      ].join(" "),
      summary,
    )
  }

  if (!args.execute || plan.changes.length === 0) {
    return summary
  }

  let updated = 0
  const updateBatchSize = DEFAULT_UPDATE_BATCH_SIZE
  const updateBatches = Math.ceil(plan.changes.length / updateBatchSize)
  const transactionOptions = {
    ...CORE_SYNC_TRANSACTION_OPTIONS,
    timeout: args.transactionTimeoutMs ?? CORE_SYNC_TRANSACTION_OPTIONS.timeout,
  }

  for (let index = 0; index < plan.changes.length; index += updateBatchSize) {
    await options.assertLockActive?.()
    const batch = plan.changes.slice(index, index + updateBatchSize)
    const affected = await withPrismaPoolTimeoutRetry(
      () =>
        prisma.$transaction(async (tx) => {
          const affectedRows = await updateRelationOrders(tx, batch)
          if (affectedRows !== batch.length) {
            throw new Error(
              [
                "Relation order update batch affected fewer rows than planned.",
                `planned=${batch.length}`,
                `affected=${affectedRows}`,
                `relationIds=${batch.map((change) => change.relationId).join(",")}`,
              ].join(" "),
            )
          }
          return affectedRows
        }, transactionOptions),
      {
        operation: `video-relation-order-backfill.batch.${Math.floor(index / updateBatchSize) + 1}`,
        sleep: options.sleep,
        onRetry: options.onPoolRetry,
      },
    )
    updated += affected
    summary = buildSummary({
      args,
      runId,
      reportPath,
      databaseIdentityHash: options.databaseIdentityHash,
      plan,
      updated,
      errors,
    })
    await writeReport(
      buildReport({
        args,
        runId,
        databaseIdentityHash: options.databaseIdentityHash,
        plan,
        summary,
      }),
      reportPath,
    )
    options.onProgress?.(
      progressFromPlan({
        phase: "update",
        batch: Math.floor(index / updateBatchSize) + 1,
        batches: updateBatches,
        batchSize: updateBatchSize,
        selected: selectedParents.length,
        selectedProcessed: selectedParents.length,
        plan,
        updated,
        errors,
      }),
    )
    await options.assertLockActive?.()
  }

  return summary
}

function defaultLogger(event: Record<string, unknown>): void {
  console.log(JSON.stringify(event))
}

export async function runRelationOrderBackfillCli({
  argv = process.argv.slice(2),
  env = process.env,
  logger = defaultLogger,
  prismaFactory,
  lockApi = { acquireSyncLock, refreshSyncLock, releaseSyncLock },
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  now = Date.now,
  writeReport,
}: {
  argv?: readonly string[]
  env?: NodeJS.ProcessEnv
  logger?: Logger
  prismaFactory?: (databaseUrl: string) => PrismaClient
  lockApi?: LockApi
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
  now?: () => number
  writeReport?: (
    report: VideoRelationOrderBackfillReport,
    reportPath: string,
  ) => Promise<void>
} = {}): Promise<BackfillVideoRelationOrderSummary> {
  let prisma: PrismaClient | null = null
  let lockId: string | null = null
  let lockAcquired = false
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let args: BackfillVideoRelationOrderArgs | null = null
  let databaseIdentity: DatabaseIdentity | null = null
  let runId: string | null = null
  let reportPath: string | null = null

  try {
    args = parseArgs(argv)
    validateArgs(args)

    const databaseUrl = env.DATABASE_URL
    if (!databaseUrl) throw new Error("DATABASE_URL is required")
    databaseIdentity = databaseIdentityForUrl(databaseUrl)
    if (args.execute && args.confirmDatabase !== databaseIdentity.hash) {
      throw new Error(
        `Execute mode requires --confirm-database=${databaseIdentity.hash}. Run a dry-run first and confirm the database identity hash.`,
      )
    }

    prisma =
      prismaFactory?.(databaseUrl) ??
      new PrismaClient({
        datasources: { db: { url: databaseUrl } },
        log: ["error", "warn"],
      })
    lockId = `video-relation-order-backfill-${now()}`
    const locked = await lockApi.acquireSyncLock(prisma, lockId)
    if (!locked) {
      throw new Error("Core sync lock is held; refusing to run backfill.")
    }
    lockAcquired = true

    let lockLostError: Error | null = null
    const assertLockActive = async (): Promise<void> => {
      if (lockLostError) throw lockLostError
      if (prisma == null || lockId == null) {
        throw new Error("Core sync lock state is unavailable.")
      }
      const ownsLock = await lockApi.refreshSyncLock(prisma, lockId)
      if (!ownsLock) {
        lockLostError = new Error("Core sync lock lost during backfill.")
        throw lockLostError
      }
    }

    heartbeat = setIntervalFn(() => {
      void assertLockActive().catch((error) => {
        lockLostError =
          error instanceof Error
            ? error
            : new Error("Core sync lock refresh failed during backfill.")
      })
    }, LOCK_HEARTBEAT_INTERVAL_MS)
    heartbeat.unref?.()

    logger({
      event: "video-relation-order.backfill.start",
      dryRun: !args.execute,
      execute: args.execute,
      fullCatalog: args.fullCatalog,
      slug: args.slug,
      coreId: args.coreId,
      limit: args.limit,
      batchSize: args.batchSize,
      allowMissingTopology: args.allowMissingTopology,
      transactionTimeoutMs: args.transactionTimeoutMs,
      reportOut: args.reportOut,
      databaseUrl: databaseIdentity.redactedUrl,
      databaseIdentityHash: databaseIdentity.hash,
    })

    runId = `video-relation-order-backfill-${now()}`
    reportPath = resolveReportPath(args, runId)
    const activeArgs = args
    const summary = await runBackfill(prisma, activeArgs, {
      assertLockActive,
      databaseIdentityHash: databaseIdentity.hash,
      reportPath,
      runId,
      writeReport,
      onPoolRetry: (event) =>
        logger({
          event: "video-relation-order.backfill.pool-retry",
          ...event,
        }),
      onProgress: activeArgs.verbose
        ? (progress) =>
            logger({
              event: "video-relation-order.backfill.progress",
              dryRun: !activeArgs.execute,
              ...progress,
            })
        : undefined,
    })

    logger({
      event: "video-relation-order.backfill.complete",
      ...summary,
    })
    return summary
  } catch (error) {
    const summary =
      error instanceof RelationOrderBackfillError ? error.summary : undefined
    logger({
      event: "video-relation-order.backfill.fatal",
      dryRun: args ? !args.execute : undefined,
      execute: args?.execute,
      runId,
      reportPath,
      databaseIdentityHash: databaseIdentity?.hash,
      selected: summary?.selected,
      fetchedCoreParents: summary?.fetchedCoreParents,
      planned: summary?.planned,
      updated: summary?.updated,
      unchanged: summary?.unchanged,
      missingCoreParents: summary?.missingCoreParents,
      missingChild: summary?.missingChild,
      missingRelation: summary?.missingRelation,
      duplicateCoreChildren: summary?.duplicateCoreChildren,
      extraAdminRelation: summary?.extraAdminRelation,
      errors: summary?.errors,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    if (heartbeat != null) {
      clearIntervalFn(heartbeat)
    }
    if (prisma != null && lockId != null && lockAcquired) {
      try {
        const released = await lockApi.releaseSyncLock(prisma, lockId)
        if (!released) {
          logger({
            event: "video-relation-order.backfill.lock-release-warning",
            runId,
            lockId,
            lockReleased: false,
          })
        }
      } catch (error) {
        logger({
          event: "video-relation-order.backfill.lock-release-warning",
          runId,
          lockId,
          lockReleased: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (prisma != null) {
      await prisma.$disconnect()
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRelationOrderBackfillCli().catch(() => {
    process.exit(1)
  })
}
