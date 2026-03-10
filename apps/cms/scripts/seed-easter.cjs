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
const CURRENT_YEAR = new Date().getFullYear()

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

    // 2) Find or create Experience "easter" with Video Hero + Container (Text + Easter Dates)
    const existing = await experienceService.findFirst({
      locale: DEFAULT_LOCALE,
      status: "published",
      filters: { slug: EASTER_EXPERIENCE_SLUG },
    })

    const introContent =
      "<p>Beyond eggs and bunnies lies the story of Jesus's life, death and resurrection. The true power of Easter goes beyond church services and rituals - and into the very reason why humans need a Savior.</p><p>The Gospels are shockingly honest about the emotions Jesus experienced - His deep anguish over one of His closest friends denying he even knew Him, and the other disciples' disbelief in His resurrection - raw emotions that mirror our own struggles.</p><p>Explore our collection of videos and interactive resources that invite you into the authentic story - one that changed history and continues to transform lives today. Because the greatest celebration in human history is about far more than traditions - it's about resurrection power.</p>"

    const videoHeroBlock = {
      __component: "sections.video-hero",
      video: video.documentId,
      streamingUrl: MUX_STREAM_URL,
      heading: "Easter",
      subheading: `Easter ${CURRENT_YEAR} — videos & resources about Lent, Holy Week, Resurrection`,
      ctaLabel: "Watch now",
      ctaLink: "",
    }

    const containerBlock = {
      __component: "sections.container",
      slots: [
        {
          gridSpan: 6,
          content: [
            {
              __component: "sections.text",
              heading: "The Real Easter story",
              subtitle:
                "Questioning? Searching? Discover the true power of Easter.",
              content: introContent,
            },
          ],
        },
        {
          gridSpan: 6,
          content: [
            {
              __component: "sections.easter-dates",
              easterDatesTitle: "When is Easter celebrated in {year}?",
              westernEasterLabel: "Western Easter (Catholic/Protestant)",
              orthodoxEasterLabel: "Orthodox",
              passoverLabel: "Jewish Passover",
              locale: "en-US",
            },
          ],
        },
      ],
    }

    const sectionBlock = {
      __component: "sections.section",
      backgroundColor: "dark",
      content: [containerBlock],
    }

    const fullBlocks = [videoHeroBlock, sectionBlock]

    if (existing) {
      const blocks = existing.blocks ?? []
      const hasVideoHero = blocks.some(
        (b) => b && b.__component === "sections.video-hero",
      )
      const hasSection = blocks.some(
        (b) => b && b.__component === "sections.section",
      )
      if (hasVideoHero && hasSection) {
        console.log(
          `[seed-easter] Experience "${EASTER_EXPERIENCE_SLUG}" already has Video Hero and Section. Skipping.`,
        )
        return
      }
      // Update can drop blocks with nested components; delete + create guarantees both blocks persist.
      await experienceService.delete({
        documentId: existing.documentId,
      })
      console.log(
        `[seed-easter] Deleted existing Experience "${EASTER_EXPERIENCE_SLUG}" to re-create with both blocks.`,
      )
    }

    await experienceService.create({
      locale: DEFAULT_LOCALE,
      status: "published",
      data: {
        slug: EASTER_EXPERIENCE_SLUG,
        title: "Easter",
        metaDescription: `Easter ${CURRENT_YEAR} — videos and resources about Lent, Holy Week, and Resurrection`,
        pathSegment: "easter",
        blocks: fullBlocks,
      },
    })
    console.log(
      `[seed-easter] Created Experience "${EASTER_EXPERIENCE_SLUG}" with Video Hero and Section (Container: Text + Easter Dates) blocks.`,
    )
  } finally {
    await app.destroy()
  }
}

main().catch((err) => {
  console.error("[seed-easter]", err)
  process.exit(1)
})
