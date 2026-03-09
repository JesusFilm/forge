/**
 * Seed script: creates the Easter Hero video and Easter experience with a Video Hero block.
 * Run from repo root: pnpm seed
 * Or from apps/cms: node scripts/seed-easter.cjs
 *
 * Requires apps/cms/.env (APP_KEYS, ADMIN_JWT_SECRET, etc.).
 * Uses CommonJS so Strapi (and lodash) load without ESM directory-import issues.
 * Builds the CMS (strapi build) first so dist has config; then loads Strapi from dist.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CJS script; require() needed for Strapi */

const path = require("node:path")
const { execSync } = require("node:child_process")
const fs = require("node:fs")

const APP_ROOT = path.join(__dirname, "..")
const DIST_CONFIG = path.join(APP_ROOT, "dist", "config", "database.js")

const EASTER_VIDEO_SLUG = "easter-hero"
const EASTER_EXPERIENCE_SLUG = "easter"
const DEFAULT_LOCALE = "en"
const MUX_STREAM_URL =
  "https://stream.mux.com/J3WBxqGgXxi01201FYmW0202ayeL7PGXfuuXR02nvjQCE7bI.m3u8"

async function main() {
  process.chdir(APP_ROOT)

  // Strapi loads config from dist; build first if config not present
  if (!fs.existsSync(DIST_CONFIG)) {
    console.log("[seed-easter] Building CMS (dist has no config yet)...")
    execSync("pnpm run build", { cwd: APP_ROOT, stdio: "inherit" })
  }

  const { createStrapi } = require("@strapi/strapi")
  const app = await createStrapi({
    distDir: path.join(APP_ROOT, "dist"),
  }).load()
  const videoService = app.documents("api::video.video")
  const experienceService = app.documents("api::experience.experience")

  try {
    // 1) Find or create Video "Easter Hero"
    let video = await videoService.findFirst({
      locale: DEFAULT_LOCALE,
      status: "published",
      filters: { slug: EASTER_VIDEO_SLUG },
    })
    if (!video) {
      video = await videoService.create({
        locale: DEFAULT_LOCALE,
        status: "published",
        data: {
          title: "Easter Hero",
          slug: EASTER_VIDEO_SLUG,
        },
      })
      console.log(
        `[seed-easter] Created Video "${video.title}" (${video.documentId})`,
      )
    } else {
      console.log(
        `[seed-easter] Using existing Video "${video.title}" (${video.documentId})`,
      )
    }

    // 2) Find or create Experience "easter" with one Video Hero block
    const existing = await experienceService.findFirst({
      locale: DEFAULT_LOCALE,
      status: "published",
      filters: { slug: EASTER_EXPERIENCE_SLUG },
    })
    if (existing) {
      console.log(
        `[seed-easter] Experience "${EASTER_EXPERIENCE_SLUG}" already exists. Skipping.`,
      )
      return
    }

    await experienceService.create({
      locale: DEFAULT_LOCALE,
      status: "published",
      data: {
        slug: EASTER_EXPERIENCE_SLUG,
        title: "Easter",
        metaDescription:
          "Easter 2025 — videos and resources about Lent, Holy Week, and Resurrection",
        pathSegment: "easter",
        blocks: [
          {
            __component: "sections.video-hero",
            video: video.documentId,
            streamingUrl: MUX_STREAM_URL,
            heading: "Easter",
            subheading:
              "Easter 2025 — videos & resources about Lent, Holy Week, Resurrection",
            ctaLabel: "Watch now",
            ctaLink: "",
          },
        ],
      },
    })
    console.log(
      `[seed-easter] Created Experience "${EASTER_EXPERIENCE_SLUG}" with Video Hero block.`,
    )
  } finally {
    await app.destroy()
  }
}

main().catch((err) => {
  console.error("[seed-easter]", err)
  process.exit(1)
})
