// Load a HUMAN-SIGNED beat sheet into video_moment_editorial — the CONSUMER
// half of the beat-sheet contract (src/services/video-moment-sheet.ts).
//
// Safety posture mirrors cleanup-legacy-openai-embeddings.ts, NOT the
// local-only seed scripts: this loader's whole purpose is a reviewed write
// into production, so it dry-runs by default and unlocks prod explicitly.
//
//   Dry-run (default):
//     DATABASE_URL=... pnpm --filter @forge/admin exec tsx \
//       src/scripts/apply-video-moment-sheet.ts --in=<sheet.json> \
//       --target-env=development
//
//   Execute against production:
//     DATABASE_URL=<prod> ... --in=<sheet.json> --target-env=production \
//       --execute --allow-production-target --report-out=<report.json>
//
// The write is all-or-nothing per (video, language): one transaction replaces
// the film's whole editorial set, so a failed run leaves the previous set
// intact and a partial panel is unrepresentable (plan: Storage Decision).

import { readFileSync, writeFileSync } from "node:fs"

import {
  validateBeatSheet,
  type BeatSheet,
} from "@/services/video-moment-sheet"

type Args = {
  in: string | undefined
  targetEnv: "development" | "production" | undefined
  execute: boolean
  allowProductionTarget: boolean
  reportOut: string | undefined
  help: boolean
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) =>
    argv
      .find((a) => a.startsWith(`--${name}=`))
      ?.slice(name.length + 3)
      ?.trim()
  const targetEnv = get("target-env")
  return {
    in: get("in"),
    targetEnv:
      targetEnv === "development" || targetEnv === "production"
        ? targetEnv
        : undefined,
    execute: argv.includes("--execute"),
    allowProductionTarget: argv.includes("--allow-production-target"),
    reportOut: get("report-out"),
    help: argv.includes("--help"),
  }
}

function usage(): never {
  console.error(
    "usage: apply-video-moment-sheet --in=<beat-sheet.json> --target-env=development|production [--execute] [--allow-production-target] [--report-out=<path>]",
  )
  process.exit(2)
}

/** A production-looking DATABASE_URL must be declared as such, and executing
 *  against it needs the explicit unlock — one axis per flag, all required. */
function assertTargetConsistency(args: Args): void {
  const url = process.env.DATABASE_URL ?? ""
  let host = ""
  try {
    host = new URL(url).hostname
  } catch {
    console.error("refusing: DATABASE_URL is missing or unparseable")
    process.exit(2)
  }
  const looksProd =
    host.endsWith(".railway.app") ||
    host.endsWith(".jesusfilm.org") ||
    host.includes("rlwy.net")
  if (looksProd && args.targetEnv !== "production") {
    console.error(
      `refusing: DATABASE_URL host "${host}" looks like production but --target-env=${args.targetEnv ?? "(unset)"}`,
    )
    process.exit(2)
  }
  if (args.targetEnv === "production" && args.execute) {
    if (!args.allowProductionTarget) {
      console.error(
        "refusing: executing against production requires --allow-production-target",
      )
      process.exit(2)
    }
    if (!args.reportOut) {
      console.error(
        "refusing: executing against production requires --report-out=<path>",
      )
      process.exit(2)
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.in || !args.targetEnv) usage()
  assertTargetConsistency(args)

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(args.in!, "utf8"))
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "apply-video-moment-sheet.unreadable",
        message: error instanceof Error ? error.message : String(error),
      }),
    )
    process.exit(1)
  }

  // Loader posture: the sheet must be signed AND fully valid — an invalid
  // reference would load fine and then be silently invisible on device.
  const validation = validateBeatSheet(raw, { requireSigned: true })
  if (!validation.ok) {
    console.error(
      JSON.stringify(
        {
          event: "apply-video-moment-sheet.invalid",
          issues: validation.issues,
        },
        null,
        2,
      ),
    )
    process.exit(1)
  }
  const sheet: BeatSheet = validation.sheet

  const { prisma } = await import("@/db/client")
  try {
    const videos = await prisma.video.findMany({
      where: { slug: sheet.videoSlug, deletedAt: null },
      select: { id: true },
    })
    if (videos.length !== 1) {
      console.error(
        JSON.stringify({
          event: "apply-video-moment-sheet.video-resolution-failed",
          slug: sheet.videoSlug,
          matches: videos.length,
        }),
      )
      process.exit(1)
    }
    const videoId = videos[0]!.id

    const existing = await prisma.videoMomentEditorial.count({
      where: { videoId, languageSlug: sheet.languageSlug },
    })

    const projection = {
      event: args.execute
        ? "apply-video-moment-sheet.execute"
        : "apply-video-moment-sheet.dry-run",
      videoSlug: sheet.videoSlug,
      videoId,
      languageSlug: sheet.languageSlug,
      reviewedBy: sheet.reviewedBy,
      beatsInSheet: sheet.beats.length,
      existingEditorialRows: existing,
      action: `replace ${existing} existing rows with ${sheet.beats.length} beats (all-or-nothing, one transaction)`,
    }
    console.log(JSON.stringify(projection, null, 2))

    if (!args.execute) {
      console.log(
        JSON.stringify({
          event: "apply-video-moment-sheet.dry-run-complete",
          hint: "re-run with --execute (and the production unlock flags if applicable) to write",
        }),
      )
      return
    }

    const reviewedAt = sheet.reviewedAt
      ? new Date(sheet.reviewedAt)
      : new Date()
    const written = await prisma.$transaction(async (tx) => {
      await tx.videoMomentEditorial.deleteMany({
        where: { videoId, languageSlug: sheet.languageSlug },
      })
      const result = await tx.videoMomentEditorial.createMany({
        data: sheet.beats.map((beat) => ({
          videoId,
          languageSlug: sheet.languageSlug,
          beatIndex: beat.beatIndex,
          startSeconds: beat.startSeconds,
          endSeconds: beat.endSeconds,
          summary: beat.summary,
          bibleVerses: beat.bibleVerses,
          question: beat.question,
          reviewedBy: sheet.reviewedBy,
          reviewedAt,
          sourceModel: sheet.sourceModel,
          sourceTranscriptId: sheet.sourceTranscriptId,
        })),
      })
      if (result.count !== sheet.beats.length) {
        // Throwing rolls the whole transaction back — the previous set
        // survives and the mismatch is loud.
        throw new Error(
          `wrote ${result.count} rows but the sheet has ${sheet.beats.length} beats`,
        )
      }
      return result.count
    })

    const report = {
      event: "apply-video-moment-sheet.complete",
      videoSlug: sheet.videoSlug,
      videoId,
      languageSlug: sheet.languageSlug,
      reviewedBy: sheet.reviewedBy,
      replacedRows: existing,
      writtenRows: written,
      sourceModel: sheet.sourceModel,
      completedAt: new Date().toISOString(),
    }
    console.log(JSON.stringify(report, null, 2))
    if (args.reportOut) {
      writeFileSync(args.reportOut, JSON.stringify(report, null, 2))
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: "apply-video-moment-sheet.failed",
      message: error instanceof Error ? error.message : String(error),
    }),
  )
  process.exit(1)
})
