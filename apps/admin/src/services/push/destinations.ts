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

/** A video or series the Watch apps show: live, published, not restricted. */
export function pushVideoDestinationWhere(
  kind: "VIDEO" | "SERIES",
): Prisma.VideoWhereInput {
  return {
    deletedAt: null,
    label:
      kind === "SERIES"
        ? { in: PUSH_SERIES_LABELS }
        : { notIn: PUSH_SERIES_LABELS },
    locales: { some: { status: LocaleStatus.PUBLISHED, deletedAt: null } },
    ...notRestrictedFromWatchWhere(),
  }
}

/** An experience locale the Watch apps show: published and not archived. */
export function pushExperienceDestinationWhere(): Prisma.ExperienceLocaleWhereInput {
  return { status: LocaleStatus.PUBLISHED, experience: { archivedAt: null } }
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
