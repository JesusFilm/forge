/**
 * R7 — what counts as a destination a tap can open.
 *
 * The picker and the schedule and send-now transitions share these predicates,
 * so a draft or watch-restricted video can neither be chosen nor sent to. The
 * not-found screen on the phone is for content unpublished after the send.
 */
import {
  LocaleStatus,
  VideoLabel,
  type Prisma,
  type PrismaClient,
  type PushDestinationKind,
} from "@prisma/client"

import { notRestrictedFromWatchWhere } from "@/services/search-watchability"

export const PUSH_SERIES_LABELS = [VideoLabel.SERIES, VideoLabel.COLLECTION]

/** The destination kinds that a `Video` row holds. */
export type PushVideoDestinationKind = Exclude<
  PushDestinationKind,
  "EXPERIENCE"
>

/** KTD9 — the kind a video's label gives it; the split the predicates use. */
export function pushVideoKindOfLabel(
  label: VideoLabel,
): PushVideoDestinationKind {
  return (PUSH_SERIES_LABELS as readonly VideoLabel[]).includes(label)
    ? "SERIES"
    : "VIDEO"
}

/** A live video row of one kind, published or not. SERIES means the series labels. */
export function pushVideoKindWhere(
  kind: PushVideoDestinationKind,
): Prisma.VideoWhereInput {
  return {
    deletedAt: null,
    label:
      kind === "SERIES"
        ? { in: PUSH_SERIES_LABELS }
        : { notIn: PUSH_SERIES_LABELS },
  }
}

function pushVideoPublishedLocaleWhere(): Prisma.VideoWhereInput {
  return {
    locales: { some: { status: LocaleStatus.PUBLISHED, deletedAt: null } },
  }
}

/** A video or series the Watch apps show: live, published, not restricted. */
export function pushVideoDestinationWhere(
  kind: PushVideoDestinationKind,
): Prisma.VideoWhereInput {
  return {
    ...pushVideoKindWhere(kind),
    ...pushVideoPublishedLocaleWhere(),
    ...notRestrictedFromWatchWhere(),
  }
}

function pushExperiencePublishedLocaleWhere(): Prisma.ExperienceLocaleWhereInput {
  return { status: LocaleStatus.PUBLISHED }
}

/** An experience locale the Watch apps show: published and not archived. */
export function pushExperienceDestinationWhere(): Prisma.ExperienceLocaleWhereInput {
  return {
    ...pushExperiencePublishedLocaleWhere(),
    experience: { archivedAt: null },
  }
}

/** The picker's and the agent's text match on a video: slug or any locale title. */
export function pushVideoSearchWhere(q: string): Prisma.VideoWhereInput {
  return q
    ? {
        OR: [
          { slug: { contains: q, mode: "insensitive" } },
          {
            locales: {
              some: { title: { contains: q, mode: "insensitive" } },
            },
          },
        ],
      }
    : {}
}

/** The picker's and the agent's text match on an experience locale. */
export function pushExperienceSearchWhere(
  q: string,
): Prisma.ExperienceLocaleWhereInput {
  return q
    ? {
        OR: [
          { slug: { contains: q, mode: "insensitive" } },
          { title: { contains: q, mode: "insensitive" } },
        ],
      }
    : {}
}

/** True while the destination still resolves as something a tap can open. */
export async function isPushDestinationPublished(
  prisma: PrismaClient,
  destination: { kind: PushDestinationKind; slug: string },
): Promise<boolean> {
  if (destination.kind === "EXPERIENCE") {
    const count = await prisma.experienceLocale.count({
      where: { ...pushExperienceDestinationWhere(), slug: destination.slug },
    })
    return count > 0
  }
  const count = await prisma.video.count({
    where: {
      ...pushVideoDestinationWhere(destination.kind),
      slug: destination.slug,
    },
  })
  return count > 0
}

/**
 * KTD9 — every kind under which a live row carries the slug, published or
 * not. The label split is the one `pushVideoDestinationWhere` uses, so a
 * slug this finds under a kind is the slug that predicate reads.
 */
export async function readPushDestinationKinds(
  prisma: PrismaClient,
  slug: string,
): Promise<PushDestinationKind[]> {
  const [videos, series, experiences] = await Promise.all([
    prisma.video.count({ where: { ...pushVideoKindWhere("VIDEO"), slug } }),
    prisma.video.count({ where: { ...pushVideoKindWhere("SERIES"), slug } }),
    prisma.experienceLocale.count({ where: { slug } }),
  ])
  const kinds: PushDestinationKind[] = []
  if (videos > 0) kinds.push("VIDEO")
  if (series > 0) kinds.push("SERIES")
  if (experiences > 0) kinds.push("EXPERIENCE")
  return kinds
}

/** KTD9 — the first piece of the published check that a live row fails. */
export type PushDestinationUnpublishedReason =
  | "no_published_locale"
  | "watch_restricted"
  | "archived"

export type PushDestinationState =
  | Readonly<{ published: true; reason: null }>
  | Readonly<{ published: false; reason: PushDestinationUnpublishedReason }>

const PUBLISHED_STATE: PushDestinationState = { published: true, reason: null }

function unpublishedState(
  reason: PushDestinationUnpublishedReason,
): PushDestinationState {
  return { published: false, reason }
}

async function videoSlugs(
  prisma: PrismaClient,
  where: Prisma.VideoWhereInput,
): Promise<Set<string>> {
  const rows = await prisma.video.findMany({ where, select: { slug: true } })
  return new Set(rows.map((row) => row.slug))
}

async function experienceSlugs(
  prisma: PrismaClient,
  where: Prisma.ExperienceLocaleWhereInput,
): Promise<Set<string>> {
  const rows = await prisma.experienceLocale.findMany({
    where,
    select: { slug: true },
    distinct: ["slug"],
  })
  return new Set(rows.map((row) => row.slug))
}

/**
 * KTD9 and KTD13 — the published state of each slug of one kind. `published`
 * reads the same predicate as `isPushDestinationPublished`, and each reason is
 * the predicate without its last piece, so the flag and the reason cannot
 * disagree. A slug with no live row of the kind is left out of the map.
 */
export async function readPushDestinationStates(
  prisma: PrismaClient,
  kind: PushDestinationKind,
  slugs: readonly string[],
): Promise<Map<string, PushDestinationState>> {
  const states = new Map<string, PushDestinationState>()
  if (slugs.length === 0) return states
  const slug = { in: [...new Set(slugs)] }

  const [live, published, publishedLocale] =
    kind === "EXPERIENCE"
      ? await Promise.all([
          experienceSlugs(prisma, { slug }),
          experienceSlugs(prisma, {
            ...pushExperienceDestinationWhere(),
            slug,
          }),
          experienceSlugs(prisma, {
            ...pushExperiencePublishedLocaleWhere(),
            slug,
          }),
        ])
      : await Promise.all([
          videoSlugs(prisma, { ...pushVideoKindWhere(kind), slug }),
          videoSlugs(prisma, { ...pushVideoDestinationWhere(kind), slug }),
          videoSlugs(prisma, {
            ...pushVideoKindWhere(kind),
            ...pushVideoPublishedLocaleWhere(),
            slug,
          }),
        ])
  // A published locale that still fails the check fails on the last piece:
  // the watch restriction for a video, the archive for an experience.
  const lastPieceReason: PushDestinationUnpublishedReason =
    kind === "EXPERIENCE" ? "archived" : "watch_restricted"

  for (const value of live) {
    if (published.has(value)) states.set(value, PUBLISHED_STATE)
    else if (publishedLocale.has(value)) {
      states.set(value, unpublishedState(lastPieceReason))
    } else states.set(value, unpublishedState("no_published_locale"))
  }
  return states
}
