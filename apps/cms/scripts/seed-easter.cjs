/**
 * Seed script: creates the Easter experience with Video Hero and
 * Section (Container: Text + Easter Dates, Easter Explained video, Related Questions) blocks.
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
const EASTER_EXPLAINED_SLUG = "easter-explained"
const EASTER_EXPLAINED_STREAM_URL =
  "https://stream.mux.com/x3XKV1Yi01z7dyF6f8ZLBMNrHtNWS02iHoQw6vIcf4hBw.m3u8"
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

    // 2) Find or create Video "Easter Explained"
    let easterExplainedVideo = await videoService.findFirst({
      locale: DEFAULT_LOCALE,
      status: "published",
      filters: { slug: EASTER_EXPLAINED_SLUG },
    })
    if (!easterExplainedVideo) {
      easterExplainedVideo = await videoService.create({
        locale: DEFAULT_LOCALE,
        status: "published",
        data: {
          title: "Easter Explained",
          slug: EASTER_EXPLAINED_SLUG,
        },
      })
      console.log(
        `[seed-easter] Created Video "${easterExplainedVideo.title}" (${easterExplainedVideo.documentId})`,
      )
    } else {
      console.log(
        `[seed-easter] Using existing Video "${easterExplainedVideo.title}" (${easterExplainedVideo.documentId})`,
      )
    }

    // 3) Find or create Experience "easter"
    const existing = await experienceService.findFirst({
      locale: DEFAULT_LOCALE,
      status: "published",
      filters: { slug: EASTER_EXPERIENCE_SLUG },
    })

    const introContent = [
      "Beyond eggs and bunnies lies the story of Jesus's life, death and resurrection. The true power of Easter goes beyond church services and rituals - and into the very reason why humans need a Savior.",
      "The Gospels are shockingly honest about the emotions Jesus experienced - His deep anguish over one of His closest friends denying he even knew Him, and the other disciples' disbelief in His resurrection - raw emotions that mirror our own struggles.",
      "Explore our collection of videos and interactive resources that invite you into the authentic story - one that changed history and continues to transform lives today. Because the greatest celebration in human history is about far more than traditions - it's about resurrection power.",
    ]

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
              contentParagraphs: introContent,
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

    const easterExplainedBlock = {
      __component: "sections.video",
      video: easterExplainedVideo.documentId,
      streamingUrl: EASTER_EXPLAINED_STREAM_URL,
      title: "Easter Explained",
      subtitle:
        "Is Easter about more than bunnies and eggs? Followers of Jesus celebrate His power of life over death on Easter Sunday. Are they right? Was He really raised from the dead?",
    }

    const easterMeaningTextBlock = {
      __component: "sections.text",
      heading: "The True Meaning of Easter",
      subtitle: "Jesus' Victory Over Sin and Death",
      variant: "lead",
      contentParagraphs: [
        "Easter is about more than eggs and bunnies\u2014it's about Jesus and His amazing love for us. He died on the cross for our sins and rose from the dead, showing His power over sin and death. Because of Him, we can have forgiveness and the promise of eternal life. Easter is a time to celebrate this great hope and God's incredible gift to us.",
      ],
    }

    const relatedQuestionsBlock = {
      __component: "sections.related-questions",
      heading: "Related questions",
      ctaLabel: "Ask yours",
      ctaLink: "https://issuesiface.com/talk?utm_source=jesusfilm-watch",
      questions: [
        {
          question:
            "How can I trust in God's sovereignty when the world feels so chaotic?",
          answer:
            "Even in times of chaos and uncertainty, we can trust in God's sovereignty because:\n\n- God remains in control even when circumstances feel out of control\n- His purposes are higher than our understanding\n- He promises to work all things for good for those who love Him\n- The Bible shows countless examples of God bringing order from chaos",
        },
        {
          question: "Why is Easter the most important Christian holiday?",
          answer:
            "Easter is central to Christian faith because:\n\n- It marks Jesus' resurrection, proving His victory over death\n- It fulfills Old Testament prophecies about the Messiah\n- It demonstrates God's power to give new life\n- It provides hope for our own resurrection and eternal life",
        },
        {
          question:
            "What happened during the three days between Jesus' death and resurrection?",
          answer:
            "The Bible tells us several key events occurred:\n\n- Jesus' body was placed in a tomb and guarded by Roman soldiers\n- His followers mourned and waited in uncertainty\n- According to Scripture, He descended to the realm of the dead\n- On the third day, He rose victorious over death",
        },
      ],
    }

    const textAndQuestionsContainer = {
      __component: "sections.container",
      slots: [
        {
          gridSpan: 7,
          content: [easterMeaningTextBlock],
        },
        {
          gridSpan: 5,
          content: [relatedQuestionsBlock],
        },
      ],
    }

    const bibleQuotesBlock = {
      __component: "sections.bible-quotes-carousel",
      sectionKey: "easter-bible-quotes",
      heading: "Bible Quotes",
      quotes: [
        {
          reference: "Luke 8:2",
          attribution: "Gospel of Luke",
          text: "And also some women who had been cured of evil spirits and diseases: Mary (called Magdalene) from whom seven demons had come out.",
          imageUrl:
            "https://images.unsplash.com/photo-1508558936510-0af1e3cccbab?w=1400&auto=format&fit=crop&q=60",
          backgroundColor: "#201617",
        },
        {
          reference: "John 20:16",
          attribution: "Gospel of John",
          text: 'Jesus said to her, "Mary." She turned toward him and cried out in Aramaic, "Rabboni!" (which means "Teacher").',
          imageUrl:
            "https://images.unsplash.com/photo-1522442676585-c751dab71864?w=900&auto=format&fit=crop&q=60",
          backgroundColor: "#A88E78",
        },
        {
          reference: "Mark 16:9",
          attribution: "Gospel of Mark",
          text: "Now when Jesus was risen early the first day of the week, he appeared first to Mary Magdalene, out of whom he had cast seven devils.",
          imageUrl:
            "https://images.unsplash.com/photo-1678181896030-11cf0237d704?w=900&auto=format&fit=crop&q=60",
          backgroundColor: "#72593A",
        },
        {
          reference: "Free Resources",
          text: "Want to deepen your understanding of Jesus' life?",
          ctaLabel: "Join Our Bible Study",
          ctaLink:
            "https://join.bsfinternational.org/?utm_source=jesusfilm-watch",
          imageUrl:
            "https://images.unsplash.com/photo-1650658720644-e1588bd66de3?w=900&auto=format&fit=crop&q=60",
          backgroundColor: "#5F4C5E",
        },
      ],
    }

    const sectionBlock = {
      __component: "sections.section",
      sectionKey: "easter-meaning",
      backgroundColor: "dark",
      content: [
        containerBlock,
        easterExplainedBlock,
        textAndQuestionsContainer,
        bibleQuotesBlock,
      ],
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
      const hasBibleQuotesCarousel = blocks.some(
        (b) =>
          b &&
          b.__component === "sections.section" &&
          Array.isArray(b.content) &&
          b.content.some(
            (c) => c && c.__component === "sections.bible-quotes-carousel",
          ),
      )
      if (hasVideoHero && hasSection && hasBibleQuotesCarousel) {
        console.log(
          `[seed-easter] Experience "${EASTER_EXPERIENCE_SLUG}" already has Video Hero, Section, and Bible Quotes. Skipping.`,
        )
        return
      }
      // Update can drop blocks with nested components; delete + create guarantees both blocks persist.
      await experienceService.delete({
        documentId: existing.documentId,
      })
      console.log(
        `[seed-easter] Deleted existing Experience "${EASTER_EXPERIENCE_SLUG}" to re-create with all blocks.`,
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
      `[seed-easter] Created Experience "${EASTER_EXPERIENCE_SLUG}" with Video Hero and Section (incl. Bible Quotes) blocks.`,
    )
  } finally {
    try {
      await app.destroy()
    } catch {
      // tarn connection-pool "aborted" error during SQLite teardown is harmless
    }
  }
}

main().catch((err) => {
  console.error("[seed-easter]", err)
  process.exit(1)
})
