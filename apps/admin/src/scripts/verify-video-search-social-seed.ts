#!/usr/bin/env tsx

import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { prisma } from "@/db/client"

export const JESUS_SEARCH_TITLE =
  "Watch JESUS — Full Movie Free Online | Jesus Film Project"
export const JESUS_SEARCH_DESCRIPTION =
  "Watch the JESUS film free online. Follow his life, teachings, miracles, death, and resurrection through the Gospel of Luke in more than 2,000 languages."

type Candidate = {
  id: string
  videoId: string
  languageCoreId: string | null
  searchTitle: string | null
  searchDescription: string | null
  socialImageAssetId: string | null
  video: { coreId: string; slug: string }
}

export function verifyJesusSearchSocialSeed(candidates: readonly Candidate[]) {
  const candidate = candidates[0]
  const checks = {
    exactlyOneCandidate: candidates.length === 1,
    searchTitle: candidate?.searchTitle === JESUS_SEARCH_TITLE,
    searchDescription:
      candidate?.searchDescription === JESUS_SEARCH_DESCRIPTION,
    noSocialImageOverride: candidate?.socialImageAssetId == null,
  }

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    candidates: candidates.map((row) => ({
      videoLocaleId: row.id,
      videoId: row.videoId,
      videoCoreId: row.video.coreId,
      videoSlug: row.video.slug,
      languageCoreId: row.languageCoreId,
    })),
  }
}

export async function main() {
  const candidates = await prisma.videoLocale.findMany({
    where: {
      deletedAt: null,
      languageCoreId: "529",
      video: {
        coreId: "1_jf-0-0",
        slug: "jesus",
        deletedAt: null,
      },
    },
    select: {
      id: true,
      videoId: true,
      languageCoreId: true,
      searchTitle: true,
      searchDescription: true,
      socialImageAssetId: true,
      video: { select: { coreId: true, slug: true } },
    },
    orderBy: { id: "asc" },
  })
  const result = verifyJesusSearchSocialSeed(candidates)
  const output = JSON.stringify(
    { event: "video_search_social.seed_verified", ...result },
    null,
    2,
  )
  if (result.ok) console.log(output)
  else {
    console.error(output)
    process.exitCode = 1
  }
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : null
if (entrypoint === resolve(fileURLToPath(import.meta.url))) {
  void main()
    .catch((error: unknown) => {
      console.error(
        JSON.stringify({
          event: "video_search_social.seed_verification_failed",
          errorName: error instanceof Error ? error.name : "UnknownError",
        }),
      )
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
