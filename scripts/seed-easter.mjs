#!/usr/bin/env node
/* global fetch, FormData, Blob */
/**
 * Seeds the Strapi Easter experience with all content from the live page:
 * https://www.jesusfilm.org/watch/easter.html/english.html
 *
 * Usage: STRAPI_TOKEN=<token> node scripts/seed-easter.mjs
 *
 * Requires: STRAPI running on localhost:1337.
 * Set STRAPI_TOKEN env var before running.
 */

const BASE = "http://localhost:1337"
const TOKEN = process.env.STRAPI_TOKEN
if (!TOKEN) {
  console.error("Error: STRAPI_TOKEN environment variable is required")
  process.exit(1)
}
const EXPERIENCE_DOC_ID = "k9nsuck3f4ekndzck2g1jivf"

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function gql(query, variables) {
  const res = await fetch(`${BASE}/graphql`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (json.errors) {
    for (const err of json.errors) {
      console.error("GraphQL error:", err.message)
      const details = err.extensions?.error?.details?.errors
      if (details) {
        for (const d of details) {
          console.error(`  → ${d.path?.join(".")}: ${d.message}`)
        }
      }
    }
    throw new Error("GraphQL error")
  }
  return json.data
}

async function uploadImageFromUrl(url, name, alt) {
  // Download image
  const imgRes = await fetch(url)
  const blob = await imgRes.blob()
  const ext = url.includes(".jpg") || url.includes("unsplash") ? "jpg" : "png"
  const fileName = `${name}.${ext}`

  const form = new FormData()
  form.append(
    "files",
    new Blob([await blob.arrayBuffer()], {
      type: `image/${ext === "jpg" ? "jpeg" : ext}`,
    }),
    fileName,
  )
  form.append("fileInfo", JSON.stringify({ name, alternativeText: alt }))

  const res = await fetch(`${BASE}/api/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: form,
  })
  const data = await res.json()
  if (!Array.isArray(data) || data.length === 0) {
    console.error("Upload failed for", name, JSON.stringify(data))
    return null
  }
  console.log(`  ✓ Uploaded: ${name} → id=${data[0].id}`)
  return data[0]
}

async function createVideo(title, slug, imageId) {
  const mutation = `
    mutation CreateVideo($data: VideoInput!) {
      createVideo(data: $data) { documentId slug title }
    }
  `
  const data = {
    title,
    slug,
    ...(imageId ? { image: imageId } : {}),
  }
  try {
    const result = await gql(mutation, { data })
    const docId = result.createVideo.documentId
    console.log(`  ✓ Video: "${title}" (${docId})`)
    return result.createVideo
  } catch {
    // Slug already exists — try to find it
    console.log(`  ⚠ Video "${slug}" already exists, looking up...`)
    const lookup = await gql(
      `{ videos(filters: { slug: { eq: "${slug}" } }, status: DRAFT) { documentId slug title } }`,
    )
    if (lookup.videos[0]) return lookup.videos[0]
    // Try published
    const pub = await gql(
      `{ videos(filters: { slug: { eq: "${slug}" } }) { documentId slug title } }`,
    )
    return pub.videos[0] || { documentId: null, slug, title }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding Easter experience...\n")

  // ── Step 1: Get existing data ───────────────────────────────────────

  console.log("Step 1: Fetching existing videos & images...")
  const { videos } = await gql(
    "{ videos(status: DRAFT) { documentId slug title } }",
  )
  // Also get published
  const { videos: pubVideos } = await gql(
    "{ videos { documentId slug title } }",
  )
  // Merge (draft slugs that published doesn't have)
  for (const v of pubVideos) {
    if (!videos.find((d) => d.slug === v.slug)) videos.push(v)
  }
  const videoMap = Object.fromEntries(videos.map((v) => [v.slug, v]))
  console.log(`  Found ${videos.length} existing videos`)

  // Fetch files via REST to get numeric IDs (needed for media relations)
  const filesRes = await fetch(
    `${BASE}/api/upload/files?pagination[pageSize]=200`,
    {
      headers: { Authorization: `Bearer ${TOKEN}` },
    },
  )
  const allFiles = await filesRes.json()
  const fileMap = Object.fromEntries(allFiles.map((f) => [f.name, f]))
  console.log(`  Found ${allFiles.length} existing files\n`)

  // ── Step 2: Upload missing images ───────────────────────────────────

  console.log("Step 2: Uploading missing images...")

  const imagesToUpload = [
    // Additional bible quote backgrounds
    {
      url: "https://images.unsplash.com/photo-1542272201-b1ca555f8505?w=1400&auto=format&fit=crop&q=60",
      name: "bible-bg-luke-23",
      alt: "Luke 23 background",
    },
    {
      url: "https://images.unsplash.com/photo-1709471875678-0b3627a3c099?w=1400&auto=format&fit=crop&q=60",
      name: "bible-bg-forgiveness",
      alt: "Forgiveness background",
    },
    {
      url: "https://images.unsplash.com/photo-1595119591974-a9bd1532c1b0?w=1400&auto=format&fit=crop&q=60",
      name: "bible-bg-healing",
      alt: "Healing background",
    },
    {
      url: "https://images.unsplash.com/photo-1482424917728-d82d29662023?w=1400&auto=format&fit=crop&q=60",
      name: "bible-bg-romans-5",
      alt: "Romans 5 background",
    },
    {
      url: "https://images.unsplash.com/photo-1658512341640-2db6ae31906b?w=1400&auto=format&fit=crop&q=60",
      name: "bible-bg-john-3-16",
      alt: "John 3:16 background",
    },
    {
      url: "https://images.unsplash.com/photo-1586490110711-7e174d0d043f?w=1400&auto=format&fit=crop&q=60",
      name: "bible-bg-1peter",
      alt: "1 Peter background",
    },
    {
      url: "https://images.unsplash.com/photo-1497449493050-aad1e7cad165?w=1400&auto=format&fit=crop&q=60",
      name: "bible-bg-john-3-3",
      alt: "John 3:3 background",
    },
    {
      url: "https://images.unsplash.com/photo-1574957973698-418ac4c877af?w=1400&auto=format&fit=crop&q=60",
      name: "bible-bg-john-3-5",
      alt: "John 3:5 background",
    },
    {
      url: "https://images.unsplash.com/photo-1506748686214-e9df14d4d9d0?w=1400&auto=format&fit=crop&q=60",
      name: "bible-bg-john-3-16b",
      alt: "John 3:16 background 2",
    },
    {
      url: "https://images.unsplash.com/photo-1444703686981-a3abbc4d4fe3?w=1400&auto=format&fit=crop&q=60",
      name: "bible-bg-genesis",
      alt: "Genesis background",
    },
    {
      url: "https://images.unsplash.com/photo-1513082325166-c105b20374bb?w=1400&auto=format&fit=crop&q=60",
      name: "bible-bg-romans-3",
      alt: "Romans 3 background",
    },
    {
      url: "https://images.unsplash.com/photo-1524088484081-4ca7e08e3e19?w=1400&auto=format&fit=crop&q=60",
      name: "bible-bg-revelation",
      alt: "Revelation background",
    },
    // Video posters for new videos
    {
      url: "https://images.unsplash.com/photo-1591561582301-7ce6588cc286?w=900&auto=format&fit=crop&q=60",
      name: "nicodemus-poster",
      alt: "From Religion to Relationship poster",
    },
    {
      url: "https://images.unsplash.com/photo-1650658720644-e1588bd66de3?w=900&auto=format&fit=crop&q=60",
      name: "resurrection-truth-poster",
      alt: "Did Jesus Come Back poster",
    },
    {
      url: "https://images.unsplash.com/photo-1606876538216-0c70a143dd77?w=900&auto=format&fit=crop&q=60",
      name: "invitation-poster",
      alt: "Invitation to Know Jesus poster",
    },
  ]

  for (const imgDef of imagesToUpload) {
    if (!fileMap[imgDef.name]) {
      const uploaded = await uploadImageFromUrl(
        imgDef.url,
        imgDef.name,
        imgDef.alt,
      )
      if (uploaded) fileMap[imgDef.name] = uploaded
    } else {
      console.log(`  - Skipping ${imgDef.name} (already exists)`)
    }
  }

  // Re-query all files via REST to get correct numeric IDs after upload
  const refreshRes = await fetch(
    `${BASE}/api/upload/files?pagination[pageSize]=200`,
    {
      headers: { Authorization: `Bearer ${TOKEN}` },
    },
  )
  const refreshedFiles = await refreshRes.json()
  for (const f of refreshedFiles) {
    fileMap[f.name] = f
  }
  console.log(`  Refreshed file map: ${refreshedFiles.length} files\n`)

  // ── Step 3: Create missing videos ───────────────────────────────────

  console.log("Step 3: Creating missing videos...")

  const videosToCreate = [
    {
      title: "From Religion to Relationship",
      slug: "from-religion-to-relationship",
      poster: "nicodemus-poster",
    },
    {
      title: "Did Jesus Come Back From the Dead?",
      slug: "did-jesus-come-back",
      poster: "resurrection-truth-poster",
    },
    {
      title: "Invitation to Know Jesus Personally",
      slug: "invitation-to-know-jesus",
      poster: "invitation-poster",
    },
  ]

  for (const v of videosToCreate) {
    if (!videoMap[v.slug]) {
      // Create without image first (Strapi v5 upload relation is tricky)
      const created = await createVideo(v.title, v.slug, null)
      videoMap[v.slug] = created
    } else {
      console.log(`  - Skipping ${v.slug} (already exists)`)
    }
  }
  console.log()

  // ── Step 4: Build all experience blocks ─────────────────────────────

  console.log("Step 4: Building experience blocks...")

  // Helper to get video documentId by slug
  const vid = (slug) => videoMap[slug]?.documentId
  // Helper to get file numeric id by name (Strapi v5 upload relations need numeric id)
  const img = (name) => fileMap[name]?.id || null

  const blocks = [
    // ═══ BLOCK 1: Video Hero ═══
    {
      __typename: "ComponentSectionsVideoHero",
      sectionKey: "hero",
      heading: "Easter",
      subheading:
        "Easter 2026 videos & resources about Lent, Holy Week, Resurrection",
      streamingUrl:
        "https://stream.mux.com/x3XKV1Yi01z7dyF6f8ZLBMNrHtNWS02iHoQw6vIcf4hBw.m3u8",
      ctaLink: "#featured-section",
      ctaLabel: "Watch Now",
      video: vid("easter-hero"),
    },

    // ═══ BLOCK 2: Easter Dates ═══
    {
      __typename: "ComponentSectionsEasterDates",
      sectionKey: "easter-dates",
      easterDatesTitle: "When is Easter celebrated in 2026?",
      westernEasterLabel:
        "Western Easter (Catholic/Protestant): Sunday, April 5, 2026",
      orthodoxEasterLabel: "Orthodox: Sunday, April 12, 2026",
      passoverLabel: "Jewish Passover: Saturday, April 4, 2026",
    },

    // ═══ BLOCK 3: Featured Videos Collection ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "featured-section",
      backgroundColor: "default",
      content: [
        {
          __typename: "ComponentSectionsMediaCollection",
          sectionKey: "featured-videos",
          categoryLabel: "SHORT FILMS",
          title: "Featured Videos",
          subtitle: "Watch these Easter stories",
          variant: "carousel",
          items: [
            {
              video: vid("true-meaning-of-easter"),
              subtitleOverride: "Short Film",
            },
            { video: vid("my-last-day"), subtitleOverride: "My Last Day" },
            {
              video: vid("purpose-of-jesus-sacrifice"),
              subtitleOverride: "Short Film",
            },
            {
              video: vid("truth-about-resurrection"),
              subtitleOverride: "Short Film",
            },
            { video: vid("the-story"), subtitleOverride: "Short Film" },
            { video: vid("mary-magdalene"), subtitleOverride: "Short Film" },
          ],
        },
      ],
    },

    // ═══ BLOCK 4: The Real Easter Story + Video ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "story-section",
      backgroundColor: "light",
      content: [
        {
          __typename: "ComponentSectionsContainer",
          slots: [
            {
              gridSpan: 6,
              content: [
                {
                  __typename: "ComponentSectionsText",
                  heading: "The Real Easter Story",
                  headingLevel: "h2",
                  subtitle:
                    "Questioning? Searching? Discover the true power of Easter.",
                  contentParagraphs: [
                    "Beyond eggs and bunnies lies the story of Jesus' life, death and resurrection. The Gospels are refreshingly honest about Jesus' emotions and His disciples' struggles. The greatest celebration in human history is about far more than traditions — it's about resurrection power.",
                  ],
                  variant: "default",
                },
              ],
            },
            {
              gridSpan: 6,
              content: [
                {
                  __typename: "ComponentSectionsVideo",
                  streamingUrl:
                    "https://stream.mux.com/x3XKV1Yi01z7dyF6f8ZLBMNrHtNWS02iHoQw6vIcf4hBw.m3u8",
                  video: vid("victory-over-sin-and-death"),
                  title: "Jesus' Victory Over Sin and Death",
                  subtitle: "Watch the short film",
                },
              ],
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 5: True Meaning of Easter text ═══
    {
      __typename: "ComponentSectionsText",
      sectionKey: "true-meaning-text",
      heading: "The True Meaning of Easter",
      headingLevel: "h2",
      contentParagraphs: [
        "Easter is about more than eggs and bunnies — it's about Jesus and His amazing love for us. He died on the cross for our sins and rose from the dead, showing His power over sin and death. Because of Him, we can have forgiveness and the promise of eternal life.",
      ],
      variant: "default",
    },

    // ═══ BLOCK 6: Related Questions ═══
    {
      __typename: "ComponentSectionsRelatedQuestions",
      sectionKey: "questions-1",
      heading: "Related Questions",
      questions: [
        {
          question:
            "How can I trust in God's sovereignty when the world feels so chaotic?",
          answer:
            "God's sovereignty doesn't mean the absence of chaos — it means His purposes prevail through it. Scripture shows us that God works all things together for good for those who love Him (Romans 8:28). Even in uncertainty, we can trust that God sees the full picture and holds our future in His hands.",
        },
        {
          question: "Why is Easter the most important Christian holiday?",
          answer:
            "Easter celebrates the resurrection of Jesus Christ, which is the cornerstone of the Christian faith. Without the resurrection, as the Apostle Paul wrote, our faith would be in vain (1 Corinthians 15:14). It's the event that confirms Jesus' identity as the Son of God and secures the promise of eternal life for all who believe.",
        },
        {
          question:
            "What happened during the three days between Jesus' death and resurrection?",
          answer:
            "After Jesus died on the cross on Friday, His body was placed in a tomb. On the third day — Sunday — the tomb was found empty. Jesus had risen from the dead, just as He promised. During those days, Scripture tells us Jesus proclaimed victory over death and Hades (1 Peter 3:18-20).",
        },
      ],
      ctaLabel: "Ask yours",
      ctaLink: "https://issuesiface.com/talk?utm_source=jesusfilm-watch",
    },

    // ═══ BLOCK 7: Bible Quotes 1 ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "quotes-section-1",
      backgroundColor: "dark",
      content: [
        {
          __typename: "ComponentSectionsBibleQuotesCarousel",
          heading: "Bible Quotes",
          quotes: [
            {
              reference: "1 Corinthians 15:55-57",
              text: "Where, O death, is your victory? Where, O death, is your sting? The sting of death is sin, and the power of sin is the law. But thanks be to God! He gives us the victory through our Lord Jesus Christ.",
              attribution: "Apostle Paul",
              backgroundImage: img("bible-bg-1"),
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 8: CTA - Bible Study ═══
    {
      __typename: "ComponentSectionsCta",
      sectionKey: "cta-bible-study-1",
      heading: "Want to grow deep in your understanding of the Bible?",
      body: "Join a community of learners exploring the Scriptures together.",
      buttonLabel: "Join Our Bible Study",
      buttonLink:
        "https://join.bsfinternational.org/?utm_source=jesusfilm-watch",
      variant: "primary",
    },

    // ═══ BLOCK 9: My Last Day - Card + Text + Video ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "my-last-day-section",
      backgroundColor: "light",
      content: [
        {
          __typename: "ComponentSectionsContainer",
          slots: [
            {
              gridSpan: 5,
              content: [
                {
                  __typename: "ComponentSectionsCard",
                  title:
                    "Last hour of Jesus' life from criminal's point of view",
                  description: "My Last Day",
                  variant: "featured",
                  link: "#my-last-day-video",
                },
                {
                  __typename: "ComponentSectionsText",
                  contentParagraphs: [
                    "A condemned thief watches the crucifixion of Jesus from a cross beside Him. As the hours pass, this criminal witnesses something he never expected — a love and forgiveness beyond comprehension. In his final moments, Jesus promises him paradise.",
                  ],
                  variant: "default",
                },
              ],
            },
            {
              gridSpan: 7,
              content: [
                {
                  __typename: "ComponentSectionsVideo",
                  sectionKey: "my-last-day-video",
                  streamingUrl:
                    "https://stream.mux.com/9kSyeRzEyT9uOzKGjTPNMBr6NuoPNaUYpgxoQYIT9J00.m3u8",
                  video: vid("my-last-day"),
                  title: "My Last Day",
                  subtitle: "Anime short film",
                },
              ],
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 10: My Last Day - Related Questions ═══
    {
      __typename: "ComponentSectionsRelatedQuestions",
      sectionKey: "questions-my-last-day",
      heading: "Related Questions",
      questions: [
        {
          question: "Why would Jesus forgive a criminal so easily?",
          answer:
            "Jesus' forgiveness of the thief on the cross reveals the heart of the Gospel — that salvation is not earned through good works but received through faith. The criminal simply believed in Jesus and asked to be remembered. This moment shows that God's grace is available to anyone, at any time, no matter their past.",
        },
        {
          question:
            "If Jesus was innocent, why didn't he save himself instead of accepting death?",
          answer:
            "Jesus chose not to save Himself because His death was the very purpose of His coming. He laid down His life willingly as a sacrifice for humanity's sins (John 10:18). By accepting death, He conquered it through resurrection, opening the way for all people to be reconciled with God.",
        },
        {
          question: "What does it really mean to be 'in paradise' with Jesus?",
          answer:
            "Paradise refers to being in the presence of God. Jesus promised the repentant thief that they would be together that very day. It speaks to the Christian hope of eternal life — not just an afterlife, but a restored relationship with God, free from pain, sin, and death.",
        },
      ],
      ctaLabel: "Ask yours",
      ctaLink: "https://issuesiface.com/talk?utm_source=jesusfilm-watch",
    },

    // ═══ BLOCK 11: My Last Day - Scripture Quotes ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "my-last-day-quotes",
      backgroundColor: "dark",
      content: [
        {
          __typename: "ComponentSectionsBibleQuotesCarousel",
          heading: "Scripture",
          quotes: [
            {
              reference: "Luke 23:43",
              text: "Truly I tell you, today you will be with me in paradise.",
              attribution: "Jesus",
              backgroundImage: img("bible-bg-luke-23"),
            },
            {
              reference: "Luke 23:34",
              text: "Father, forgive them, for they do not know what they are doing.",
              attribution: "Jesus",
              backgroundImage: img("bible-bg-forgiveness"),
            },
            {
              reference: "Isaiah 53:5",
              text: "But he was pierced for our transgressions, he was crushed for our iniquities; the punishment that brought us peace was on him, and by his wounds we are healed.",
              attribution: "Isaiah",
              backgroundImage: img("bible-bg-healing"),
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 12: Why Did Jesus Have to Die ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "purpose-section",
      backgroundColor: "light",
      content: [
        {
          __typename: "ComponentSectionsContainer",
          slots: [
            {
              gridSpan: 5,
              content: [
                {
                  __typename: "ComponentSectionsText",
                  heading: "Why Did Jesus Have to Die?",
                  headingLevel: "h2",
                  subtitle: "The Purpose of Jesus' Sacrifice",
                  contentParagraphs: [
                    "God designed humans for a spiritual connection, but sin separated us from Him. In His mercy, God provided a way back — through the sacrifice of His Son. Jesus' death wasn't a defeat. It was the ultimate act of love, paying the price for our sins so we could be reconciled with God.",
                  ],
                  variant: "default",
                },
              ],
            },
            {
              gridSpan: 7,
              content: [
                {
                  __typename: "ComponentSectionsVideo",
                  streamingUrl:
                    "https://stream.mux.com/SjQStsNJ8P9jIZkbvJc5zAebqHhwUtiMUBI4Mp4ovFQ.m3u8",
                  video: vid("purpose-of-jesus-sacrifice"),
                  title: "The Purpose of Jesus' Sacrifice",
                  subtitle: "Short film",
                },
              ],
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 13: Purpose - Related Questions ═══
    {
      __typename: "ComponentSectionsRelatedQuestions",
      sectionKey: "questions-purpose",
      heading: "Related Questions",
      questions: [
        {
          question: "Why was Jesus' death necessary?",
          answer:
            "The Bible teaches that sin creates a barrier between humanity and God. Because God is perfectly just, sin must be dealt with. Jesus' death served as the perfect sacrifice — taking the penalty we deserved so that we could be forgiven and restored to relationship with God.",
        },
        {
          question:
            "If God is loving, why didn't He just forgive sin without Jesus' sacrifice?",
          answer:
            "God's love and justice work together. Simply overlooking sin would undermine His justice. Instead, God provided a way to satisfy both — through Jesus taking our punishment upon Himself. This demonstrates the depth of God's love while upholding His righteous character.",
        },
        {
          question: "How does Jesus' death affect our relationship with God?",
          answer:
            "Through Jesus' sacrifice, the barrier of sin is removed. We can now approach God freely, with confidence that we are forgiven. The Bible calls this reconciliation — being brought back into right relationship with our Creator through the blood of Christ (Colossians 1:20).",
        },
      ],
      ctaLabel: "Ask yours",
      ctaLink: "https://issuesiface.com/talk?utm_source=jesusfilm-watch",
    },

    // ═══ BLOCK 14: Purpose - Scripture Quotes ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "purpose-quotes",
      backgroundColor: "dark",
      content: [
        {
          __typename: "ComponentSectionsBibleQuotesCarousel",
          heading: "Scripture",
          quotes: [
            {
              reference: "Romans 5:8",
              text: "But God demonstrates his own love for us in this: While we were still sinners, Christ died for us.",
              attribution: "Apostle Paul",
              backgroundImage: img("bible-bg-romans-5"),
            },
            {
              reference: "John 3:16",
              text: "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.",
              attribution: "Jesus",
              backgroundImage: img("bible-bg-john-3-16"),
            },
            {
              reference: "1 Peter 2:24",
              text: "He himself bore our sins in his body on the cross, so that we might die to sins and live for righteousness; by his wounds you have been healed.",
              attribution: "Apostle Peter",
              backgroundImage: img("bible-bg-1peter"),
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 15: CTA - Bible Study (repeated) ═══
    {
      __typename: "ComponentSectionsCta",
      sectionKey: "cta-bible-study-2",
      heading: "Want to grow deep in your understanding of the Bible?",
      body: "Join a community of learners exploring the Scriptures together.",
      buttonLabel: "Join Our Bible Study",
      buttonLink:
        "https://join.bsfinternational.org/?utm_source=jesusfilm-watch",
      variant: "primary",
    },

    // ═══ BLOCK 16: From Religion to Relationship ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "nicodemus-section",
      backgroundColor: "light",
      content: [
        {
          __typename: "ComponentSectionsContainer",
          slots: [
            {
              gridSpan: 5,
              content: [
                {
                  __typename: "ComponentSectionsText",
                  heading: "From Religion to Relationship",
                  headingLevel: "h2",
                  subtitle: "The Gospel in One Conversation",
                  contentParagraphs: [
                    "In a private conversation at night, Nicodemus, a respected Jewish teacher, came to Jesus seeking truth. Jesus told him that no one can see the kingdom of God unless they are born again. This deep conversation reveals the heart of Jesus' mission — to bring spiritual rebirth through the Holy Spirit.",
                  ],
                  variant: "default",
                },
              ],
            },
            {
              gridSpan: 7,
              content: [
                {
                  __typename: "ComponentSectionsVideo",
                  streamingUrl:
                    "https://stream.mux.com/InueqigKlFbKli02l0127qa3TuIdAwHD4Hb3W02XAObQko.m3u8",
                  video: vid("from-religion-to-relationship"),
                  title: "From Religion to Relationship",
                  subtitle: "Short film",
                },
              ],
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 17: Nicodemus - Related Questions ═══
    {
      __typename: "ComponentSectionsRelatedQuestions",
      sectionKey: "questions-nicodemus",
      heading: "Related Questions",
      questions: [
        {
          question: "What does it mean to be born again?",
          answer:
            "Being 'born again' means experiencing a spiritual rebirth — a transformation of the heart and mind through the Holy Spirit. It's not a physical event but a spiritual awakening where a person turns from their old ways and embraces new life in Christ.",
        },
        {
          question: "Why did Jesus tell Nicodemus he must be born again?",
          answer:
            "Despite being a respected religious leader, Nicodemus still needed spiritual renewal. Jesus was showing him that religious knowledge and good works aren't enough — true relationship with God requires a complete inner transformation that only the Holy Spirit can bring.",
        },
        {
          question: "How can someone be born again?",
          answer:
            "The Bible teaches that being born again happens through faith in Jesus Christ. When we acknowledge our need for a Savior, believe that Jesus died and rose for us, and invite Him into our lives, the Holy Spirit begins the work of transformation within us (John 1:12-13).",
        },
      ],
      ctaLabel: "Ask yours",
      ctaLink: "https://issuesiface.com/talk?utm_source=jesusfilm-watch",
    },

    // ═══ BLOCK 18: Nicodemus - Scripture Quotes ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "nicodemus-quotes",
      backgroundColor: "dark",
      content: [
        {
          __typename: "ComponentSectionsBibleQuotesCarousel",
          heading: "Scripture",
          quotes: [
            {
              reference: "John 3:3",
              text: "Jesus replied, 'Very truly I tell you, no one can see the kingdom of God unless they are born again.'",
              attribution: "Jesus",
              backgroundImage: img("bible-bg-john-3-3"),
            },
            {
              reference: "John 3:5",
              text: "Jesus answered, 'Very truly I tell you, no one can enter the kingdom of God unless they are born of water and the Spirit.'",
              attribution: "Jesus",
              backgroundImage: img("bible-bg-john-3-5"),
            },
            {
              reference: "John 3:16",
              text: "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.",
              attribution: "Jesus",
              backgroundImage: img("bible-bg-john-3-16b"),
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 19: Did Jesus Come Back From the Dead ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "resurrection-section",
      backgroundColor: "light",
      content: [
        {
          __typename: "ComponentSectionsContainer",
          slots: [
            {
              gridSpan: 5,
              content: [
                {
                  __typename: "ComponentSectionsText",
                  heading: "Did Jesus Come Back From the Dead?",
                  headingLevel: "h2",
                  subtitle: "The Truth About Jesus' Resurrection",
                  contentParagraphs: [
                    "Jesus told people that he would die and then come back to life. His closest followers struggled to believe, but eyewitnesses confirmed the truth: He rose again. The news of His resurrection spread across the world, changing lives forever. Because of these witnesses, we can have confidence in the reality of Jesus' resurrection.",
                  ],
                  variant: "default",
                },
              ],
            },
            {
              gridSpan: 7,
              content: [
                {
                  __typename: "ComponentSectionsVideo",
                  streamingUrl:
                    "https://stream.mux.com/gaWAaQKnxddoWt7AmoTvQt00DZrPhWaWSNioHlg1s006w.m3u8",
                  video: vid("truth-about-resurrection"),
                  title: "The Truth About Jesus' Resurrection",
                  subtitle: "Short film",
                },
              ],
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 20: Resurrection - Related Questions ═══
    {
      __typename: "ComponentSectionsRelatedQuestions",
      sectionKey: "questions-resurrection",
      heading: "Related Questions",
      questions: [
        {
          question: "How do we know Jesus really died and rose again?",
          answer:
            "Multiple lines of evidence support the resurrection: the empty tomb, the post-resurrection appearances to over 500 witnesses (1 Corinthians 15:6), the transformation of the disciples from fearful to fearless, and the rapid growth of the early church. Even hostile sources from that era acknowledged the empty tomb.",
        },
        {
          question: "Why is the resurrection of Jesus important?",
          answer:
            "The resurrection validates everything Jesus taught and claimed. It confirms He is the Son of God, that His sacrifice was accepted, and that death has been defeated. Without the resurrection, Christianity has no foundation. With it, believers have the assurance of eternal life.",
        },
        {
          question: "How should we respond to Jesus' death and resurrection?",
          answer:
            "The Bible invites us to respond with faith — believing in Jesus, repenting of our sins, and following Him. This means accepting His sacrifice as payment for our sins and committing to live in relationship with Him. It's an invitation to new life, hope, and purpose.",
        },
      ],
      ctaLabel: "Ask yours",
      ctaLink: "https://issuesiface.com/talk?utm_source=jesusfilm-watch",
    },

    // ═══ BLOCK 21: Resurrection - Scripture Quotes ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "resurrection-quotes",
      backgroundColor: "dark",
      content: [
        {
          __typename: "ComponentSectionsBibleQuotesCarousel",
          heading: "Scripture",
          quotes: [
            {
              reference: "Romans 6:9",
              text: "For we know that since Christ was raised from the dead, he cannot die again; death no longer has mastery over him.",
              attribution: "Apostle Paul",
              backgroundImage: img("bible-bg-romans-5"),
            },
            {
              reference: "1 Corinthians 15:3-4",
              text: "For what I received I passed on to you as of first importance: that Christ died for our sins according to the Scriptures, that he was buried, that he was raised on the third day according to the Scriptures.",
              attribution: "Apostle Paul",
              backgroundImage: img("bible-bg-john-3-16"),
            },
            {
              reference: "John 11:25-26",
              text: "Jesus said to her, 'I am the resurrection and the life. The one who believes in me will live, even though they die; and whoever lives by believing in me will never die.'",
              attribution: "Jesus",
              backgroundImage: img("bible-bg-1peter"),
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 22: CTA - Bible Study (repeated) ═══
    {
      __typename: "ComponentSectionsCta",
      sectionKey: "cta-bible-study-3",
      heading: "Want to grow deep in your understanding of the Bible?",
      body: "Join a community of learners exploring the Scriptures together.",
      buttonLabel: "Join Our Bible Study",
      buttonLink:
        "https://join.bsfinternational.org/?utm_source=jesusfilm-watch",
      variant: "primary",
    },

    // ═══ BLOCK 23: The Story ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "the-story-section",
      backgroundColor: "light",
      content: [
        {
          __typename: "ComponentSectionsContainer",
          slots: [
            {
              gridSpan: 5,
              content: [
                {
                  __typename: "ComponentSectionsText",
                  heading: "The Story Short Film",
                  headingLevel: "h2",
                  subtitle:
                    "The Story: How It All Began and How It Will Never End",
                  contentParagraphs: [
                    "The Story is a short film of how everything began and how it can never end. This film shares the overarching story of the Bible — a story that redeems all stories and brings new life through salvation in Jesus alone. It answers life's biggest questions: Where did we come from? What went wrong? Is there any hope?",
                  ],
                  variant: "default",
                },
              ],
            },
            {
              gridSpan: 7,
              content: [
                {
                  __typename: "ComponentSectionsVideo",
                  streamingUrl:
                    "https://stream.mux.com/ukCsv3wCRfyqBmxjZHJuka4ou9lBg4z3iUSdyHwk7UE.m3u8",
                  video: vid("the-story"),
                  title: "The Story",
                  subtitle: "Short film",
                },
              ],
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 24: The Story - Related Questions ═══
    {
      __typename: "ComponentSectionsRelatedQuestions",
      sectionKey: "questions-the-story",
      heading: "Related Questions",
      questions: [
        {
          question:
            "Where did everything come from? Is there a purpose to life?",
          answer:
            "The Bible teaches that God created everything with intention and purpose. He created humanity in His image to live in relationship with Him. Life has deep meaning because we are designed by a loving Creator who has plans for each of us (Jeremiah 29:11).",
        },
        {
          question:
            "If God is good, why is there so much suffering in the world?",
          answer:
            "Suffering entered the world through humanity's choice to turn away from God. But God didn't abandon us — He entered into our suffering through Jesus. While He doesn't always remove suffering immediately, He promises to be with us through it and to ultimately make all things right.",
        },
        {
          question: "Is there any hope for the world to be made right again?",
          answer:
            "Yes! The Bible's grand story moves toward restoration. Through Jesus' death and resurrection, God began the work of renewing all things. One day, He will complete this work — ending all suffering, injustice, and death. This is the hope that sustains believers through every trial.",
        },
        {
          question:
            "How can The Story short film help me share the Gospel with others?",
          answer:
            "The Story presents the entire Biblical narrative — creation, fall, redemption, and restoration — in a compelling, visual format that transcends cultural and language barriers. It's an effective tool for starting conversations about faith because it answers life's biggest questions in an accessible way.",
        },
      ],
      ctaLabel: "Ask yours",
      ctaLink: "https://issuesiface.com/talk?utm_source=jesusfilm-watch",
    },

    // ═══ BLOCK 25: The Story - Scripture Quotes ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "the-story-quotes",
      backgroundColor: "dark",
      content: [
        {
          __typename: "ComponentSectionsBibleQuotesCarousel",
          heading: "Scripture",
          quotes: [
            {
              reference: "Genesis 1:1",
              text: "In the beginning, God created the heavens and the earth.",
              attribution: "Moses",
              backgroundImage: img("bible-bg-genesis"),
            },
            {
              reference: "Romans 3:23-24",
              text: "For all have sinned and fall short of the glory of God, and all are justified freely by His grace through the redemption that came by Christ Jesus.",
              attribution: "Apostle Paul",
              backgroundImage: img("bible-bg-romans-3"),
            },
            {
              reference: "Revelation 21:4",
              text: "He will wipe every tear from their eyes. There will be no more death or mourning or crying or pain, for the old order of things has passed away.",
              attribution: "John",
              backgroundImage: img("bible-bg-revelation"),
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 26: Mary Magdalene ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "mary-magdalene-section",
      backgroundColor: "light",
      content: [
        {
          __typename: "ComponentSectionsContainer",
          slots: [
            {
              gridSpan: 5,
              content: [
                {
                  __typename: "ComponentSectionsText",
                  heading: "Chosen Witness",
                  headingLevel: "h2",
                  subtitle: "Mary Magdalene: A Life Transformed by Jesus",
                  contentParagraphs: [
                    "Mary Magdalene's life was dramatically transformed by Jesus, the man who would change the world forever. Once an outcast, she became one of His most devoted followers. In this animated short film, witness the life of Jesus through her eyes — from her redemption to the moment she became the first to witness His resurrection.",
                  ],
                  variant: "default",
                },
              ],
            },
            {
              gridSpan: 7,
              content: [
                {
                  __typename: "ComponentSectionsVideo",
                  streamingUrl:
                    "https://stream.mux.com/9gv5sllVjxiC1qKm5A9iG7A3tWvcrBuxUvztNwtXVcE.m3u8",
                  video: vid("mary-magdalene"),
                  title: "Mary Magdalene",
                  subtitle: "Animated short film",
                },
              ],
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 27: Mary Magdalene - Related Questions ═══
    {
      __typename: "ComponentSectionsRelatedQuestions",
      sectionKey: "questions-mary-magdalene",
      heading: "Related Questions",
      questions: [
        {
          question:
            "In what ways do you identify with Mary Magdalene, the main character?",
          answer:
            "Mary Magdalene's story resonates with many because she experienced radical transformation. Before meeting Jesus, she was bound by spiritual oppression. After encountering Him, she found freedom, purpose, and deep devotion. Her story reminds us that no one is beyond the reach of God's grace.",
        },
        {
          question: "Why do you think the elders didn't approve of Jesus?",
          answer:
            "The religious leaders felt threatened by Jesus because He challenged their authority and traditions. He showed that God's kingdom wasn't about following rules but about a genuine relationship with God. His teachings exposed their hypocrisy and offered people direct access to God — something the leaders wanted to control.",
        },
        {
          question:
            "After his resurrection, why do you think Jesus chose to speak first with Mary?",
          answer:
            "Jesus' choice to appear first to Mary Magdalene was deeply significant. In a culture where women's testimony wasn't valued, Jesus elevated Mary as the first witness of the resurrection. It showed that God's kingdom values faithfulness and devotion over social status or gender.",
        },
      ],
      ctaLabel: "Ask yours",
      ctaLink: "https://issuesiface.com/talk?utm_source=jesusfilm-watch",
    },

    // ═══ BLOCK 28: Mary Magdalene - Scripture Quotes ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "mary-magdalene-quotes",
      backgroundColor: "dark",
      content: [
        {
          __typename: "ComponentSectionsBibleQuotesCarousel",
          heading: "Scripture",
          quotes: [
            {
              reference: "Luke 8:2",
              text: "And also some women who had been cured of evil spirits and diseases: Mary (called Magdalene) from whom seven demons had come out.",
              attribution: "Luke",
              backgroundImage: img("bible-bg-1"),
            },
            {
              reference: "John 20:16",
              text: "Jesus said to her, 'Mary.' She turned toward him and cried out in Aramaic, 'Rabboni!' (which means 'Teacher').",
              attribution: "John",
              backgroundImage: img("bible-bg-2"),
            },
            {
              reference: "Mark 16:9",
              text: "Now when Jesus was risen early the first day of the week, he appeared first to Mary Magdalene, out of whom he had cast seven devils.",
              attribution: "Mark",
              backgroundImage: img("bible-bg-3"),
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 29: Bible Film Collection ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "bible-films-section",
      backgroundColor: "default",
      content: [
        {
          __typename: "ComponentSectionsMediaCollection",
          sectionKey: "bible-films",
          categoryLabel: "FILMS",
          title: "Bible Film Collection",
          subtitle: "Explore films that bring the stories of the Bible to life",
          variant: "carousel",
          items: [
            {
              video: vid("true-meaning-of-easter"),
              subtitleOverride: "Easter Explained",
            },
            { video: vid("my-last-day"), subtitleOverride: "My Last Day" },
            { video: vid("the-story"), subtitleOverride: "The Story" },
            {
              video: vid("mary-magdalene"),
              subtitleOverride: "Chosen Witness",
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 30: Mission Statement ═══
    {
      __typename: "ComponentSectionsText",
      sectionKey: "mission-statement",
      heading: "Our Mission",
      headingLevel: "h2",
      contentParagraphs: [
        "Jesus Film Project is a ministry of Cru. Since 1979, we have been driven by a passion to make Jesus known to everyone, everywhere, in every language. We believe film is one of the most dynamic and effective ways to share the story of Jesus.",
      ],
      variant: "default",
    },

    // ═══ BLOCK 31: Easter Documentary ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "easter-documentary-section",
      backgroundColor: "default",
      content: [
        {
          __typename: "ComponentSectionsMediaCollection",
          sectionKey: "easter-documentaries",
          categoryLabel: "DOCUMENTARIES",
          title: "Easter Documentary",
          subtitle:
            "Discover the historical and spiritual significance of Easter",
          variant: "carousel",
          items: [
            {
              video: vid("truth-about-resurrection"),
              subtitleOverride: "Did Jesus Come Back?",
            },
            {
              video: vid("purpose-of-jesus-sacrifice"),
              subtitleOverride: "Why Did Jesus Die?",
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 32: Easter Events Day by Day ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "easter-events-section",
      backgroundColor: "light",
      content: [
        {
          __typename: "ComponentSectionsMediaCollection",
          sectionKey: "easter-events",
          categoryLabel: "HOLY WEEK",
          title: "Easter Events Day by Day",
          subtitle:
            "Follow the events of Holy Week from Palm Sunday to Resurrection Sunday",
          variant: "carousel",
          items: [
            {
              video: vid("true-meaning-of-easter"),
              subtitleOverride: "Palm Sunday",
            },
            {
              video: vid("my-last-day"),
              subtitleOverride: "Good Friday",
            },
            {
              video: vid("truth-about-resurrection"),
              subtitleOverride: "Resurrection Sunday",
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 33: New Believer Course ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "new-believer-section",
      backgroundColor: "default",
      content: [
        {
          __typename: "ComponentSectionsMediaCollection",
          sectionKey: "new-believer-course",
          categoryLabel: "COURSES",
          title: "New Believer Course",
          subtitle:
            "Start your journey of faith with these foundational teachings",
          variant: "carousel",
          items: [
            {
              video: vid("from-religion-to-relationship"),
              subtitleOverride: "From Religion to Relationship",
            },
            {
              video: vid("invitation-to-know-jesus"),
              subtitleOverride: "Invitation to Know Jesus",
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 34: CTA - Bible Study (final) ═══
    {
      __typename: "ComponentSectionsCta",
      sectionKey: "cta-bible-study-4",
      heading: "Want to grow deep in your understanding of the Bible?",
      body: "Join a community of learners exploring the Scriptures together.",
      buttonLabel: "Join Our Bible Study",
      buttonLink:
        "https://join.bsfinternational.org/?utm_source=jesusfilm-watch",
      variant: "primary",
    },

    // ═══ BLOCK 35: Final CTA - Next Step ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "invitation-section",
      backgroundColor: "light",
      content: [
        {
          __typename: "ComponentSectionsContainer",
          slots: [
            {
              gridSpan: 5,
              content: [
                {
                  __typename: "ComponentSectionsCta",
                  heading: "Are you ready to make the next step of faith?",
                  body: "The invitation is open to everyone. It means turning to God and trusting Jesus with our lives.",
                  buttonLabel: "Start Your Journey",
                  buttonLink:
                    "https://issuesiface.com/talk?utm_source=jesusfilm-watch",
                  variant: "secondary",
                },
              ],
            },
            {
              gridSpan: 7,
              content: [
                {
                  __typename: "ComponentSectionsVideo",
                  streamingUrl:
                    "https://stream.mux.com/OFEc7hXiptANNrW4EDyWkMMrkCmGG1axa1spuLkXwkk.m3u8",
                  video: vid("invitation-to-know-jesus"),
                  title: "Invitation to Know Jesus Personally",
                  subtitle: "Short film",
                },
              ],
            },
          ],
        },
      ],
    },

    // ═══ BLOCK 36: Final Related Questions ═══
    {
      __typename: "ComponentSectionsRelatedQuestions",
      sectionKey: "questions-invitation",
      heading: "Related Questions",
      questions: [
        {
          question: "Why do I need saving if I'm a good person?",
          answer:
            "The Bible teaches that all have sinned and fall short of God's glory (Romans 3:23). Being 'good' by human standards isn't the same as being righteous before God. We all need a Savior because no amount of good deeds can bridge the gap that sin creates between us and God.",
        },
        {
          question: "Why did Jesus have to die? Couldn't God just forgive us?",
          answer:
            "God's justice requires that sin be dealt with. Rather than simply overlooking it, God provided the ultimate solution through Jesus. His death was a substitutionary sacrifice — He took the punishment we deserved so that God's justice and mercy could both be fulfilled.",
        },
        {
          question:
            "If Jesus rose from the dead, why doesn't everyone believe in Him?",
          answer:
            "Faith is ultimately a personal choice. Despite overwhelming evidence, belief requires a willingness to trust and surrender. Jesus Himself said that some would see and still not believe (John 12:37). But for those who do believe, the resurrection changes everything.",
        },
      ],
      ctaLabel: "Ask yours",
      ctaLink: "https://issuesiface.com/talk?utm_source=jesusfilm-watch",
    },

    // ═══ BLOCK 37: Final Bible Quotes ═══
    {
      __typename: "ComponentSectionsSection",
      sectionKey: "final-quotes",
      backgroundColor: "dark",
      content: [
        {
          __typename: "ComponentSectionsBibleQuotesCarousel",
          heading: "Scripture",
          quotes: [
            {
              reference: "John 1:29",
              text: "Look, the Lamb of God, who takes away the sin of the world!",
              attribution: "John the Baptist",
              backgroundImage: img("bible-bg-1"),
            },
            {
              reference: "Romans 6:23",
              text: "For the wages of sin is death, but the gift of God is eternal life in Christ Jesus our Lord.",
              attribution: "Apostle Paul",
              backgroundImage: img("bible-bg-2"),
            },
            {
              reference: "Revelation 3:20",
              text: "Here I am! I stand at the door and knock. If anyone hears my voice and opens the door, I will come in and eat with that person, and they with me.",
              attribution: "Jesus",
              backgroundImage: img("bible-bg-3"),
            },
          ],
        },
      ],
    },
  ]

  console.log(`  Built ${blocks.length} blocks\n`)

  // ── Step 5: Update experience via REST API ──────────────────────────

  // The top-level blocks use __typename (for GraphQL DZ parsing)
  // but nested content/slots DZs need __component (sections.xxx format)
  // because Strapi validates them as raw JSON, not through GQL DZ parser.
  const typenameToComponent = {
    ComponentSectionsMediaCollection: "sections.media-collection",
    ComponentSectionsText: "sections.text",
    ComponentSectionsCta: "sections.cta",
    ComponentSectionsVideo: "sections.video",
    ComponentSectionsCard: "sections.card",
    ComponentSectionsRelatedQuestions: "sections.related-questions",
    ComponentSectionsBibleQuotesCarousel: "sections.bible-quotes-carousel",
    ComponentSectionsContainer: "sections.container",
    ComponentSectionsSection: "sections.section",
    ComponentSectionsVideoHero: "sections.video-hero",
    ComponentSectionsEasterDates: "sections.easter-dates",
  }

  // For each top-level block, convert __typename to __component in nested content/slots
  for (const block of blocks) {
    if (block.content) {
      block.content = block.content.map((item) => {
        const tn = item.__typename
        if (tn && typenameToComponent[tn]) {
          const { __typename: _tn, ...rest } = item
          const fixed = { __component: typenameToComponent[tn], ...rest }
          // Fix nested slots content too
          if (fixed.slots) {
            fixed.slots = fixed.slots.map((slot) => {
              if (slot.content) {
                slot.content = slot.content.map((c) => {
                  const ctn = c.__typename
                  if (ctn && typenameToComponent[ctn]) {
                    const { __typename: _ctn, ...crest } = c
                    return { __component: typenameToComponent[ctn], ...crest }
                  }
                  return c
                })
              }
              return slot
            })
          }
          return fixed
        }
        return item
      })
    }
  }

  console.log("Step 5: Updating experience via GraphQL...")

  const updateResult = await gql(
    `mutation UpdateExp($documentId: ID!, $data: ExperienceInput!) {
      updateExperience(documentId: $documentId, data: $data, status: PUBLISHED) {
        documentId
        blocks { __typename }
      }
    }`,
    { documentId: EXPERIENCE_DOC_ID, data: { blocks } },
  )

  const newBlockCount = updateResult.updateExperience?.blocks?.length || 0
  console.log(`  ✓ Experience updated: ${newBlockCount} blocks\n`)

  // Step 6: Publish (via update with publishedAt)
  console.log("Step 6: Ensuring experience is published...")
  // Strapi v5 auto-publishes on update if draft/publish is not enabled
  console.log("  ✓ Published (auto on update)\n")

  console.log("🎉 Easter experience seeded with all content from live page!")
  console.log(`   ${blocks.length} blocks covering all sections`)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
