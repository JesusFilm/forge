import type { Core } from "@strapi/strapi"

import {
  DEFAULT_LOCALE,
  findOrCreatePublishedVideo,
  getExperienceService,
} from "./seed-utils"

const CHRISTMAS_EXPERIENCE_SLUG = "christmas"
const CURRENT_YEAR = new Date().getFullYear()

// ── Mux streaming URLs ─────────────────────────────────────────────────────
// NOTE: These are placeholder URLs reused from existing JesusFilm content.
// Replace with Christmas-specific Mux playback IDs when available.
const MUX = {
  heroBackground:
    "https://stream.mux.com/wmW7kl00pR1qV006mKESP53IfjJqBPNOGqX019m01OpJBDc.m3u8",
  annunciation:
    "https://stream.mux.com/qH01ZLw4Q9jY502H64aLaBLx0258k2RSHu7a8Gr01XmoA02w.m3u8",
  magnificat:
    "https://stream.mux.com/yC00yI5w4pFJblV87j2hpj7Gqw9mzkRrLG3600vqN9cfQ.m3u8",
  birthAndShepherds:
    "https://stream.mux.com/jiGmpWOOZ96iTdfoc12e6sMmfNMgh9ASXWfpIyC01OJY.m3u8",
  magi: "https://stream.mux.com/9DZZw15nfp3XpD6zrG7IIpVjKKrucR9KGp1A7YaMatc.m3u8",
  incarnation:
    "https://stream.mux.com/ftcj4dvCb56015MPKHUizfZxVPEBPw7aSNWo2ig00FOXc.m3u8",
  theStoryShortFilm:
    "https://stream.mux.com/ukCsv3wCRfyqBmxjZHJuka4ou9lBg4z3iUSdyHwk7UE.m3u8",
  invitationToKnowJesus:
    "https://stream.mux.com/00EamMd1vjQPSI3402YD4Mc4QjRzyRByLKSBjkjoTor8Q.m3u8",
} as const

// ── Image CDN helpers ───────────────────────────────────────────────────────
const IMG = "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA"
const imgCinematic = (id: string) =>
  `${IMG}/${id}.mobileCinematicHigh.jpg/f=jpg,w=1280,h=600,q=95`

const UNSPLASH = "https://images.unsplash.com"
const unsplash = (id: string, w = 900) =>
  `${UNSPLASH}/${id}?w=${w}&auto=format&fit=crop&q=60`

const COLLECTION_POSTERS = {
  jesus: "/images/thumbnails/1_jf-0-0-vertical.png",
  lifeOfJesus: "/images/thumbnails/2_GOJ-0-0-vertical.png",
  gospelOfMatthew: "/images/thumbnails/GOMattCollection-vertical.png",
  gospelOfMark: "/images/thumbnails/GOMarkCollection-vertical.png",
  gospelOfLuke: "/images/thumbnails/GOLukeCollection-vertical.png",
  gospelOfJohn: "/images/thumbnails/GOJohnCollection-vertical.png",
} as const

const BSF_CTA = "https://join.bsfinternational.org/?utm_source=jesusfilm-watch"
const ISSUES_CTA = "https://issuesiface.com/talk?utm_source=jesusfilm-watch"

// ── Helper: build video section content blocks ──────────────────────────────

function buildVideoSectionContent(opts: {
  sectionKey: string
  videoId: number
  streamingUrl: string
  title: string
  subtitle: string
  description: string[]
  questions: { question: string; answer: string }[]
  bibleQuotes: {
    reference: string
    attribution?: string
    text: string
    imageUrl: string
    backgroundColor: string
    ctaLabel?: string
    ctaLink?: string
  }[]
  textHeading?: string
  textSubtitle?: string
}) {
  const videoBlock = {
    __component: "sections.video" as const,
    sectionKey: opts.sectionKey,
    video: opts.videoId,
    streamingUrl: opts.streamingUrl,
    title: opts.title,
    subtitle: opts.subtitle,
  }

  const textBlock: Record<string, unknown> = {
    __component: "sections.text" as const,
    contentParagraphs: opts.description,
  }
  if (opts.textHeading) textBlock.heading = opts.textHeading
  if (opts.textSubtitle) textBlock.subtitle = opts.textSubtitle

  const container = {
    __component: "sections.container" as const,
    slots: [
      { gridSpan: 7, content: [textBlock] },
      {
        gridSpan: 5,
        content: [
          {
            __component: "sections.related-questions" as const,
            heading: "Related questions",
            ctaLabel: "Ask yours",
            ctaLink: ISSUES_CTA,
            questions: opts.questions,
          },
        ],
      },
    ],
  }

  const quotes = {
    __component: "sections.bible-quotes-carousel" as const,
    sectionKey: `${opts.sectionKey}-bible-quotes`,
    heading: "Bible quotes",
    quotes: opts.bibleQuotes,
  }

  const quizButton = {
    __component: "sections.quiz-button" as const,
    buttonText: "What's your next step of faith?",
    iframeSrc: "https://your.nextstep.is/embed/christmas2026?expand=false",
  }

  return [videoBlock, container, quotes, quizButton]
}

// ── Main seed function ──────────────────────────────────────────────────────

export async function seedChristmas(strapi: Core.Strapi): Promise<void> {
  const experienceService = getExperienceService(strapi)

  // ── Create all video documents ──────────────────────────────────────────

  const heroVideo = await findOrCreatePublishedVideo(
    strapi,
    "considering-christmas",
    "Considering Christmas",
  )
  const annunciationVideo = await findOrCreatePublishedVideo(
    strapi,
    "the-annunciation",
    "The Annunciation",
  )
  const magnificatVideo = await findOrCreatePublishedVideo(
    strapi,
    "mary-visits-elizabeth",
    "Mary Visits Elizabeth",
  )
  const birthVideo = await findOrCreatePublishedVideo(
    strapi,
    "the-birth-of-jesus",
    "The Birth of Jesus",
  )
  await findOrCreatePublishedVideo(
    strapi,
    "lumo-luke-1-57-2-40",
    "LUMO - Luke 1:57-2:40",
  )
  const magiVideo = await findOrCreatePublishedVideo(
    strapi,
    "lumo-matthew-1-1-2-23",
    "LUMO - Matthew 1:1-2:23",
  )
  const incarnationVideo = await findOrCreatePublishedVideo(
    strapi,
    "god-word-becomes-flesh",
    "God's Word Becomes Flesh",
  )
  const theStoryVideo = await findOrCreatePublishedVideo(
    strapi,
    "the-story-short-film",
    "The Story",
  )
  const invitationVideo = await findOrCreatePublishedVideo(
    strapi,
    "invitation-to-know-jesus-personally",
    "Invitation to Know Jesus Personally",
  )

  // Collection videos (shared with Easter)
  const collectionSlugs = [
    { slug: "jesus", title: "JESUS" },
    {
      slug: "life-of-jesus-gospel-of-john",
      title: "Life of Jesus (Gospel of John)",
    },
    {
      slug: "lumo-the-gospel-of-matthew",
      title: "LUMO - The Gospel of Matthew",
    },
    { slug: "lumo-the-gospel-of-mark", title: "LUMO - The Gospel of Mark" },
    { slug: "lumo-the-gospel-of-luke", title: "LUMO - The Gospel of Luke" },
    { slug: "lumo-the-gospel-of-john", title: "LUMO - The Gospel of John" },
  ]
  const collectionIds: number[] = []
  for (const v of collectionSlugs) {
    const doc = await findOrCreatePublishedVideo(strapi, v.slug, v.title)
    collectionIds.push(doc.id)
  }

  // NBC videos (shared with Easter)
  const nbcEpisodes = [
    { slug: "1-the-simple-gospel", title: "1. The Simple Gospel" },
    { slug: "2-the-blood-of-jesus", title: "2. The Blood of Jesus" },
    { slug: "3-life-after-death", title: "3. Life After Death" },
    { slug: "4-god-forgiveness", title: "4. God's Forgiveness" },
    { slug: "5-savior-lord-and-friend", title: "5. Savior, Lord, and Friend" },
    { slug: "6-being-made-new", title: "6. Being Made New" },
    { slug: "7-living-for-god", title: "7. Living for God" },
    { slug: "8-the-bible", title: "8. The Bible" },
    { slug: "9-prayer", title: "9. Prayer" },
    { slug: "10-church", title: "10. Church" },
  ]
  const nbcMuxUrls = [
    "https://stream.mux.com/279mJsIfidib02HlmY2Px01yCfAQ5urCkfimsCcJ36rBA.m3u8",
    "https://stream.mux.com/8qf4FwfwVe8LbH651SRJ2vLuQkks3Zz015y2b7Cnfg1A.m3u8",
    "https://stream.mux.com/C3TuBfyhZlXLQu6YGYPq1Ny6zzb9h802MDerNO9opED4.m3u8",
    "https://stream.mux.com/59urXjF6lnYwyTVbk9PBDS008GEkDDLUS8u2vfCV2pNo.m3u8",
    "https://stream.mux.com/EDzAZinsWhcEY1fbU2NpDw5XMjscjq01GVAARzmqcoy8.m3u8",
    "https://stream.mux.com/BQiPugpj0001dK3sI00I01ij7Nd1cyaucQKb6iSn3YMThWI.m3u8",
    "https://stream.mux.com/OGBK61ML9PXXQCCsUYJ7Q023X4s3j3FXC2tGEtkq8Nmg.m3u8",
    "https://stream.mux.com/S00MMmNY1Ho3fhcndh7ZkRQCKlEMQHtPXZnbkjXZXyu8.m3u8",
    "https://stream.mux.com/kzDfGLuPcBkAlrbIaSjEe3Q00eoK023CFU02MwUnzzuU8g.m3u8",
    "https://stream.mux.com/mFdtM2c02RSUcACqXv700etuF702JUpA02vRZzxMCr2Y5ic.m3u8",
  ]
  const nbcImgs = [
    "8_NBC01",
    "8_NBC02",
    "8_NBC03",
    "8_NBC04",
    "8_NBC05",
    "8_NBC06",
    "8_NBC07",
    "8_NBC08",
    "8_NBC09",
    "8_NBC10",
  ]
  const nbcIds: number[] = []
  for (const ep of nbcEpisodes) {
    const doc = await findOrCreatePublishedVideo(strapi, ep.slug, ep.title)
    nbcIds.push(doc.id)
  }

  // ── Delete existing experience so seed updates always propagate ─────────

  const existing = await experienceService.findFirst({
    locale: DEFAULT_LOCALE,
    status: "published",
    filters: { slug: CHRISTMAS_EXPERIENCE_SLUG },
  })
  if (existing) {
    await experienceService.delete({ documentId: existing.documentId })
    strapi.log.info(
      `[seed-christmas] Deleted existing Experience "${CHRISTMAS_EXPERIENCE_SLUG}" for re-creation.`,
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BLOCK ORDER: Hero > Main (Nav + Intro + Advent + Annunciation) >
  // Collection > Mary & Elizabeth > Birth & Shepherds > Magi > Incarnation >
  // The Story > NBC > Invitation
  // ══════════════════════════════════════════════════════════════════════════

  // ── 1. Hero ───────────────────────────────────────────────────────────

  const heroBlock = {
    __component: "sections.video-hero" as const,
    video: heroVideo.id,
    streamingUrl: MUX.heroBackground,
    heading: "Christmas",
    subheading: `Christmas ${CURRENT_YEAR} \u2014 the story of Jesus' birth through film, scripture, and reflection`,
    ctaLabel: "Watch now",
    ctaLink: "",
  }

  // ── 2. Main (nav + intro + Advent Countdown + Annunciation) ───────────

  const mainSection = {
    __component: "sections.section" as const,
    sectionKey: "christmas-story",
    backgroundColor: "dark" as const,
    staticOverlay: false,
    content: [
      {
        __component: "sections.navigation-carousel" as const,
        sectionKey: "christmas-navigation",
        items: [
          {
            contentId: "annunciation-section/english",
            title: "The Annunciation: Gabriel Appears to Mary",
            category: "LUMO Luke",
            imageUrl: unsplash("photo-1482235225574-c37692835cf3"),
            backgroundColor: "#1A1815",
          },
          {
            contentId: "mary-elizabeth-section/english",
            title: "Mary & Elizabeth: The Magnificat",
            category: "LUMO Luke",
            imageUrl: unsplash("photo-1512909006721-3d6018887383"),
            backgroundColor: "#A88E78",
          },
          {
            contentId: "birth-shepherds-section/english",
            title: "The Birth of Jesus & The Shepherds",
            category: "JESUS Film",
            imageUrl: unsplash("photo-1545622783-b3e021430fee"),
            backgroundColor: "#62884C",
          },
          {
            contentId: "magi-star-section/english",
            title: "The Magi & The Star of Bethlehem",
            category: "LUMO Matthew",
            imageUrl: unsplash("photo-1476820865390-c52aeebb9891"),
            backgroundColor: "#5F4C5E",
          },
          {
            contentId: "incarnation-section/english",
            title: "The Word Became Flesh",
            category: "Life of Jesus",
            imageUrl: unsplash("photo-1507692049790-de58290a4334"),
            backgroundColor: "#72593A",
          },
          {
            contentId: "the-story-section/english",
            title: "The Story: How It All Began",
            category: "Short Film",
            imageUrl: unsplash("photo-1678181896030-11cf0237d704"),
            backgroundColor: "#1C160B",
          },
        ],
      },
      {
        __component: "sections.container" as const,
        slots: [
          {
            gridSpan: 6,
            content: [
              {
                __component: "sections.text" as const,
                heading: "The Christmas Story",
                subtitle:
                  "Journey through the birth of Jesus \u2014 from prophecy to incarnation",
                contentParagraphs: [
                  "The Christmas story is far more than a manger scene. It begins with an angelic announcement to a young woman in Nazareth and unfolds through miraculous events that changed the course of human history.",
                  "From the prophecies of Isaiah to the shepherds\u2019 fields outside Bethlehem, from the journey of the Magi following a star to the profound theological truth that God became human \u2014 the nativity is a story of hope, wonder, and divine love.",
                  "Explore our collection of films and resources that bring the Christmas story to life through the Gospels of Matthew, Luke, and John.",
                ],
              },
            ],
          },
          {
            gridSpan: 6,
            content: [
              {
                __component: "sections.advent-countdown" as const,
                title: "Countdown to Christmas {year}",
                scripture:
                  "For to us a child is born, to us a son is given, and the government will be on his shoulders. And he will be called Wonderful Counselor, Mighty God, Everlasting Father, Prince of Peace.",
                scriptureReference: "Isaiah 9:6",
                locale: "en-US",
              },
            ],
          },
        ],
      },
      ...buildVideoSectionContent({
        sectionKey: "annunciation-section/english",
        videoId: annunciationVideo.id,
        streamingUrl: MUX.annunciation,
        title: "The Annunciation",
        subtitle:
          "Gabriel appears to Mary, announcing she will conceive and bear the Son of the Most High",
        textHeading: "The Annunciation: Gabriel Appears to Mary",
        textSubtitle: "The Prophecy Fulfilled",
        description: [
          "In the town of Nazareth, the angel Gabriel appeared to a young woman named Mary with an extraordinary message: she would conceive by the Holy Spirit and give birth to a son named Jesus, who would be called the Son of the Most High.",
          "Mary\u2019s courageous response \u2014 \u2018I am the Lord\u2019s servant. May your word to me be fulfilled\u2019 \u2014 set in motion the greatest story ever told. Her faith in the face of the impossible reminds us that God often works through ordinary people to accomplish extraordinary purposes.",
        ],
        questions: [
          {
            question: "Why was Mary chosen to be the mother of Jesus?",
            answer:
              "The Bible describes Mary as \u2018highly favored\u2019 by God. She was chosen not for her status or wealth, but for her faith and willingness to surrender to God\u2019s plan.",
          },
          {
            question: "What does the Annunciation teach us about faith?",
            answer:
              "Mary\u2019s response shows that faith often means saying \u2018yes\u2019 to God even when we don\u2019t fully understand. True faith trusts God\u2019s character when circumstances seem impossible.",
          },
          {
            question: "How does Jesus fulfill Old Testament prophecies?",
            answer:
              "Isaiah prophesied that a virgin would conceive and bear a son called \u2018Immanuel\u2019 \u2014 God with us. Jesus\u2019 birth fulfilled this and hundreds of other prophecies written centuries earlier.",
          },
        ],
        bibleQuotes: [
          {
            reference: "Luke 1:30-33",
            attribution: "Angel Gabriel",
            text: "\u201CDo not be afraid, Mary; you have found favor with God. You will conceive and give birth to a son, and you are to call him Jesus. He will be great and will be called the Son of the Most High.\u201D",
            imageUrl: unsplash("photo-1508558936510-0af1e3cccbab", 1400),
            backgroundColor: "#1A1815",
          },
          {
            reference: "Isaiah 7:14",
            attribution: "Prophet Isaiah",
            text: "\u201CTherefore the Lord himself will give you a sign: The virgin will conceive and give birth to a son, and will call him Immanuel.\u201D",
            imageUrl: unsplash("photo-1522442676585-c751dab71864"),
            backgroundColor: "#A88E78",
          },
          {
            reference: "Luke 1:37",
            attribution: "Angel Gabriel",
            text: "\u201CFor no word from God will ever fail.\u201D",
            imageUrl: unsplash("photo-1678181896030-11cf0237d704"),
            backgroundColor: "#72593A",
          },
          {
            reference: "Free Resources",
            text: "Want to grow deeper in your understanding of the Bible?",
            ctaLabel: "Join Our Bible Study",
            ctaLink: BSF_CTA,
            imageUrl: unsplash("photo-1650658720644-e1588bd66de3"),
            backgroundColor: "#5F4C5E",
          },
        ],
      }),
    ],
  }

  // ── 3. Bible Collection ───────────────────────────────────────────────

  const collectionSection = {
    __component: "sections.section" as const,
    sectionKey: "video-bible-collection-section",
    backgroundColor: "purple" as const,
    dynamicBackgroundImage: true,
    staticOverlay: true,
    content: [
      {
        __component: "sections.media-collection" as const,
        sectionKey: "video-bible-collection",
        categoryLabel: "Video Bible Collection",
        variant: "carousel",
        title: "The Christmas story unfolds across the Gospels",
        ctaLink: "https://www.jesusfilm.org/watch?utm_source=jesusfilm-watch",
        ctaLabel: "Watch",
        footerText:
          "Our mission is to introduce people to the Bible through films and videos that faithfully bring the Gospels to life. By visually telling the story of Jesus and God\u2019s love for humanity, we make Scripture more accessible, engaging, and easy to understand.",
        items: [
          {
            video: collectionIds[0],
            labelOverride: "Feature Film",
            collectionSize: "61 chapters",
            imageUrl: COLLECTION_POSTERS.jesus,
            subtitleOverride:
              "Jesus constantly surprises and confounds people, from His miraculous birth to His rise from the grave.",
          },
          {
            video: collectionIds[1],
            labelOverride: "Feature Film",
            collectionSize: "49 chapters",
            imageUrl: COLLECTION_POSTERS.lifeOfJesus,
            subtitleOverride:
              "And truly Jesus did many other signs in the presence of His disciples, which are not written in this book.",
          },
          {
            video: collectionIds[2],
            labelOverride: "Collection",
            collectionSize: "25 items",
            imageUrl: COLLECTION_POSTERS.gospelOfMatthew,
            subtitleOverride:
              "The Gospel of Matthew is a word-for-word portrayal of the biblical text.",
          },
          {
            video: collectionIds[3],
            labelOverride: "Collection",
            collectionSize: "15 items",
            imageUrl: COLLECTION_POSTERS.gospelOfMark,
            subtitleOverride:
              "According to the Gospel of Mark, Jesus is a heroic man of action, healer, and miracle worker.",
          },
          {
            video: collectionIds[4],
            labelOverride: "Collection",
            collectionSize: "26 items",
            imageUrl: COLLECTION_POSTERS.gospelOfLuke,
            subtitleOverride:
              "Luke acts as a narrator of events, painting a picture of Jesus as a very human character.",
          },
          {
            video: collectionIds[5],
            labelOverride: "Collection",
            collectionSize: "22 items",
            imageUrl: COLLECTION_POSTERS.gospelOfJohn,
            subtitleOverride:
              "The Gospel of John is a word-for-word portrayal of the biblical text.",
          },
        ],
      },
    ],
  }

  // ── 4. Mary & Elizabeth ────────────────────────────────────────────────

  const maryElizabethSection = {
    __component: "sections.section" as const,
    sectionKey: "mary-elizabeth-section",
    backgroundColor: "dark" as const,
    staticOverlay: false,
    content: buildVideoSectionContent({
      sectionKey: "mary-elizabeth-section/english",
      videoId: magnificatVideo.id,
      streamingUrl: MUX.magnificat,
      title: "Mary & Elizabeth: The Magnificat",
      subtitle: "Mary visits Elizabeth and her soul magnifies the Lord",
      textHeading: "Mary & Elizabeth: The Magnificat",
      textSubtitle: "Two Women, One Extraordinary Promise",
      description: [
        "When Mary arrived at Elizabeth\u2019s home, something miraculous happened \u2014 Elizabeth\u2019s baby leaped in her womb, and Elizabeth was filled with the Holy Spirit. She declared Mary \u2018blessed among women\u2019 and blessed the child she carried.",
        "Mary responded with one of the most beautiful songs in Scripture \u2014 the Magnificat \u2014 praising God for His faithfulness to His promises and His special care for the humble and lowly. This encounter confirmed God\u2019s plan and strengthened both women\u2019s faith.",
      ],
      questions: [
        {
          question: "What is the Magnificat and why is it important?",
          answer:
            "The Magnificat is Mary\u2019s song of praise recorded in Luke 1:46-55. It celebrates God\u2019s faithfulness, His care for the humble, and His fulfillment of promises made to Abraham and his descendants.",
        },
        {
          question: "How did Elizabeth know about Mary\u2019s child?",
          answer:
            "When Mary greeted Elizabeth, the baby in Elizabeth\u2019s womb leaped for joy, and Elizabeth was filled with the Holy Spirit, who revealed that Mary was carrying the Lord.",
        },
        {
          question: "What does Mary\u2019s story teach about humility?",
          answer:
            "Mary was a young woman of humble means, yet God chose her for the greatest honor in history. Her story shows that God values faithful hearts over worldly status.",
        },
      ],
      bibleQuotes: [
        {
          reference: "Luke 1:46-49",
          attribution: "Mary",
          text: "\u201CMy soul glorifies the Lord and my spirit rejoices in God my Savior, for he has been mindful of the humble state of his servant. From now on all generations will call me blessed, for the Mighty One has done great things for me.\u201D",
          imageUrl: unsplash("photo-1508558936510-0af1e3cccbab", 1400),
          backgroundColor: "#1A1815",
        },
        {
          reference: "Luke 1:41-42",
          text: "When Elizabeth heard Mary\u2019s greeting, the baby leaped in her womb, and Elizabeth was filled with the Holy Spirit. In a loud voice she exclaimed: \u2018Blessed are you among women, and blessed is the child you will bear!\u2019",
          imageUrl: unsplash("photo-1522442676585-c751dab71864"),
          backgroundColor: "#A88E78",
        },
        {
          reference: "Luke 1:37",
          attribution: "Angel Gabriel",
          text: "\u201CFor no word from God will ever fail.\u201D",
          imageUrl: unsplash("photo-1678181896030-11cf0237d704"),
          backgroundColor: "#72593A",
        },
        {
          reference: "Free Resources",
          text: "Want to grow deeper in your understanding of the Bible?",
          ctaLabel: "Join Our Bible Study",
          ctaLink: BSF_CTA,
          imageUrl: unsplash("photo-1650658720644-e1588bd66de3"),
          backgroundColor: "#5F4C5E",
        },
      ],
    }),
  }

  // ── 5. Birth & Shepherds ──────────────────────────────────────────────

  const birthShepherdsSection = {
    __component: "sections.section" as const,
    sectionKey: "birth-shepherds-section",
    backgroundColor: "dark" as const,
    staticOverlay: false,
    content: buildVideoSectionContent({
      sectionKey: "birth-shepherds-section/english",
      videoId: birthVideo.id,
      streamingUrl: MUX.birthAndShepherds,
      title: "The Birth of Jesus & The Shepherds",
      subtitle:
        "In Bethlehem, the Savior is born \u2014 and angels announce it to shepherds in the fields",
      textHeading: "The Birth of Jesus & The Shepherds",
      textSubtitle: "Glory to God in the Highest",
      description: [
        "In the town of Bethlehem, while Mary and Joseph were far from home for a Roman census, Jesus was born and laid in a manger because there was no room for them in the inn. The King of Kings entered the world in the humblest of circumstances.",
        "That night, shepherds keeping watch over their flocks were startled by an angel announcing \u2018good news that will cause great joy for all the people.\u2019 Then a great company of the heavenly host appeared, praising God. The shepherds hurried to find the baby, exactly as the angel had described.",
      ],
      questions: [
        {
          question: "Why was Jesus born in a manger?",
          answer:
            "Jesus was born in a manger because there was no room in the inn when Mary and Joseph arrived in Bethlehem for the census. This humble birth fulfilled prophecy and demonstrated that God\u2019s kingdom values are different from the world\u2019s.",
        },
        {
          question: "Why did the angels appear to shepherds first?",
          answer:
            "Shepherds were among the lowest social classes in ancient Israel. God chose to announce Jesus\u2019 birth to them first, showing that the good news was for everyone \u2014 especially the humble and marginalized.",
        },
        {
          question:
            "What does \u2018peace on earth\u2019 mean in the Christmas story?",
          answer:
            "The angels declared \u2018peace on earth to those on whom God\u2019s favor rests.\u2019 This peace is not merely the absence of conflict, but reconciliation between God and humanity made possible through Jesus.",
        },
      ],
      bibleQuotes: [
        {
          reference: "Luke 2:10-14",
          attribution: "Angel of the Lord",
          text: "\u201CDo not be afraid. I bring you good news that will cause great joy for all the people. Today in the town of David a Savior has been born to you; he is the Messiah, the Lord... Glory to God in the highest heaven, and on earth peace to those on whom his favor rests.\u201D",
          imageUrl: unsplash("photo-1508558936510-0af1e3cccbab", 1400),
          backgroundColor: "#1A1815",
        },
        {
          reference: "Luke 2:7",
          text: "She wrapped him in cloths and placed him in a manger, because there was no guest room available for them.",
          imageUrl: unsplash("photo-1522442676585-c751dab71864"),
          backgroundColor: "#A88E78",
        },
        {
          reference: "Micah 5:2",
          attribution: "Prophet Micah",
          text: "\u201CBut you, Bethlehem Ephrathah, though you are small among the clans of Judah, out of you will come for me one who will be ruler over Israel, whose origins are from of old, from ancient times.\u201D",
          imageUrl: unsplash("photo-1678181896030-11cf0237d704"),
          backgroundColor: "#72593A",
        },
        {
          reference: "Free Resources",
          text: "Want to grow deeper in your understanding of the Bible?",
          ctaLabel: "Join Our Bible Study",
          ctaLink: BSF_CTA,
          imageUrl: unsplash("photo-1650658720644-e1588bd66de3"),
          backgroundColor: "#5F4C5E",
        },
      ],
    }),
  }

  // ── 6. Magi & Star ────────────────────────────────────────────────────

  const magiSection = {
    __component: "sections.section" as const,
    sectionKey: "magi-star-section",
    backgroundColor: "dark" as const,
    staticOverlay: false,
    content: buildVideoSectionContent({
      sectionKey: "magi-star-section/english",
      videoId: magiVideo.id,
      streamingUrl: MUX.magi,
      title: "The Magi & The Star of Bethlehem",
      subtitle: "Wise men from the East follow a star to find the newborn King",
      textHeading: "The Magi & The Star of Bethlehem",
      textSubtitle: "Seekers from the East",
      description: [
        "After Jesus was born, wise men from the East saw a special star and followed it to Jerusalem, asking \u2018Where is the one who has been born king of the Jews?\u2019 Their journey of faith led them to Bethlehem, where they found the child with Mary and worshipped Him, presenting gifts of gold, frankincense, and myrrh.",
        "Each gift carried prophetic significance: gold for a king, frankincense for God, and myrrh foreshadowing His sacrificial death. The Magi\u2019s story reminds us that Jesus came not just for Israel, but for all nations \u2014 and that those who seek Him with sincere hearts will find Him.",
      ],
      questions: [
        {
          question: "Who were the Magi and where did they come from?",
          answer:
            "The Magi were likely scholars or astronomers from Persia or Babylon. They studied the stars and ancient prophecies, including those of Daniel who had lived in Babylon centuries earlier.",
        },
        {
          question: "What was the significance of the gifts?",
          answer:
            "Gold symbolized Jesus\u2019 kingship, frankincense His deity (used in temple worship), and myrrh His future suffering and death (used in burial preparation). Together they acknowledged Jesus as King, God, and Savior.",
        },
        {
          question: "Why did the star lead the Magi to Jesus?",
          answer:
            "God used the star as a sign to guide the Magi to Jesus. This fulfilled the prophecy in Numbers 24:17 about a star rising from Jacob. God meets seekers where they are \u2014 for astronomers, He used a star.",
        },
      ],
      bibleQuotes: [
        {
          reference: "Matthew 2:1-2",
          text: "After Jesus was born in Bethlehem in Judea, during the time of King Herod, Magi from the east came to Jerusalem and asked, \u2018Where is the one who has been born king of the Jews? We saw his star when it rose and have come to worship him.\u2019",
          imageUrl: unsplash("photo-1508558936510-0af1e3cccbab", 1400),
          backgroundColor: "#1A1815",
        },
        {
          reference: "Matthew 2:10-11",
          text: "When they saw the star, they were overjoyed. On coming to the house, they saw the child with his mother Mary, and they bowed down and worshiped him. Then they opened their treasures and presented him with gifts of gold, frankincense and myrrh.",
          imageUrl: unsplash("photo-1522442676585-c751dab71864"),
          backgroundColor: "#A88E78",
        },
        {
          reference: "Numbers 24:17",
          attribution: "Prophet Balaam",
          text: "\u201CA star will come out of Jacob; a scepter will rise out of Israel.\u201D",
          imageUrl: unsplash("photo-1678181896030-11cf0237d704"),
          backgroundColor: "#72593A",
        },
        {
          reference: "Free Resources",
          text: "Want to grow deeper in your understanding of the Bible?",
          ctaLabel: "Join Our Bible Study",
          ctaLink: BSF_CTA,
          imageUrl: unsplash("photo-1650658720644-e1588bd66de3"),
          backgroundColor: "#5F4C5E",
        },
      ],
    }),
  }

  // ── 7. The Incarnation ────────────────────────────────────────────────

  const incarnationSection = {
    __component: "sections.section" as const,
    sectionKey: "incarnation-section",
    backgroundColor: "dark" as const,
    staticOverlay: false,
    content: buildVideoSectionContent({
      sectionKey: "incarnation-section/english",
      videoId: incarnationVideo.id,
      streamingUrl: MUX.incarnation,
      title: "The Word Became Flesh",
      subtitle:
        "God\u2019s Word Becomes Flesh \u2014 the theological heart of Christmas",
      textHeading: "The Word Became Flesh",
      textSubtitle: "The Incarnation: God Becomes Human",
      description: [
        "The Gospel of John opens with one of the most profound statements in all of Scripture: \u2018In the beginning was the Word, and the Word was with God, and the Word was God.\u2019 This Word \u2014 the eternal Son of God \u2014 \u2018became flesh and made his dwelling among us.\u2019",
        "The incarnation is the theological heart of Christmas. It means that the infinite, all-powerful Creator of the universe chose to enter His creation as a vulnerable baby. He took on human nature not to condemn the world, but to save it. In Jesus, we see what God is truly like \u2014 full of grace and truth.",
      ],
      questions: [
        {
          question: "What does \u2018the Word became flesh\u2019 mean?",
          answer:
            "It means that Jesus, who existed eternally with God and as God, took on a human body and human nature. He became fully human while remaining fully divine \u2014 the mystery at the heart of the Christian faith.",
        },
        {
          question: "Why did God become human?",
          answer:
            "God became human to reveal Himself to us, to live a perfect life on our behalf, to bear our sins on the cross, and to defeat death through His resurrection. Only someone who was both God and human could bridge the gap between us and God.",
        },
        {
          question: "How does the incarnation relate to the manger scene?",
          answer:
            "The manger scene is the incarnation made visible. The baby in the feeding trough is the eternal Word of God \u2014 the one through whom all things were made \u2014 choosing vulnerability and humility to reach us.",
        },
      ],
      bibleQuotes: [
        {
          reference: "John 1:14",
          attribution: "Apostle John",
          text: "The Word became flesh and made his dwelling among us. We have seen his glory, the glory of the one and only Son, who came from the Father, full of grace and truth.",
          imageUrl: unsplash("photo-1508558936510-0af1e3cccbab", 1400),
          backgroundColor: "#1A1815",
        },
        {
          reference: "John 1:1-3",
          attribution: "Apostle John",
          text: "In the beginning was the Word, and the Word was with God, and the Word was God. He was with God in the beginning. Through him all things were made; without him nothing was made that has been made.",
          imageUrl: unsplash("photo-1522442676585-c751dab71864"),
          backgroundColor: "#A88E78",
        },
        {
          reference: "Philippians 2:6-8",
          attribution: "Apostle Paul",
          text: "Who, being in very nature God, did not consider equality with God something to be used to his own advantage; rather, he made himself nothing by taking the very nature of a servant, being made in human likeness.",
          imageUrl: unsplash("photo-1678181896030-11cf0237d704"),
          backgroundColor: "#72593A",
        },
        {
          reference: "Free Resources",
          text: "Want to grow deeper in your understanding of the Bible?",
          ctaLabel: "Join Our Bible Study",
          ctaLink: BSF_CTA,
          imageUrl: unsplash("photo-1650658720644-e1588bd66de3"),
          backgroundColor: "#5F4C5E",
        },
      ],
    }),
  }

  // ── 8. The Story Short Film ───────────────────────────────────────────

  const storySection = {
    __component: "sections.section" as const,
    sectionKey: "the-story-section",
    backgroundColor: "dark" as const,
    staticOverlay: false,
    content: buildVideoSectionContent({
      sectionKey: "the-story-section/english",
      videoId: theStoryVideo.id,
      streamingUrl: MUX.theStoryShortFilm,
      title: "The Story Short Film",
      subtitle: "The Story: How It All Began and How It Will Never End",
      textSubtitle: "The Story Short Film",
      textHeading: "The Story: How It All Began and How It Will Never End",
      description: [
        "The Story is a short film of how everything began and how it can never end. This film shares the overarching story of the Bible, a story that redeems all stories and brings new life through salvation in Jesus alone. It answers life\u2019s biggest questions: Where did we come from? What went wrong? Is there any hope? And what does the future hold?",
      ],
      questions: [
        {
          question:
            "Where did everything come from? Is there a purpose to life?",
          answer:
            "The Bible teaches that God created the heavens and the earth with purpose and intention. Every person is created in God\u2019s image, with inherent value and purpose.",
        },
        {
          question:
            "If God is good, why is there so much suffering in the world?",
          answer:
            "Suffering entered the world through humanity\u2019s choice to turn away from God. But God did not abandon us\u2014He sent Jesus to restore what was broken.",
        },
        {
          question: "Is there any hope for the world to be made right again?",
          answer:
            "Yes. Through Jesus\u2019 death and resurrection, God has begun the work of making all things new. He promises a future with no more pain, death, or tears.",
        },
      ],
      bibleQuotes: [
        {
          reference: "Genesis 3:15",
          text: "And I will put enmity between you and the woman, and between your offspring and hers; he will crush your head, and you will strike his heel.",
          imageUrl: unsplash("photo-1444703686981-a3abbc4d4fe3", 1400),
          backgroundColor: "#1A1815",
        },
        {
          reference: "Isaiah 53:5",
          attribution: "Prophet Isaiah",
          text: "But he was pierced for our transgressions, he was crushed for our iniquities; the punishment that brought us peace was on him, and by his wounds we are healed.",
          imageUrl: unsplash("photo-1513082325166-c105b20374bb", 1400),
          backgroundColor: "#72593A",
        },
        {
          reference: "John 3:16",
          attribution: "Jesus",
          text: "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.",
          imageUrl: unsplash("photo-1524088484081-4ca7e08e3e19", 1400),
          backgroundColor: "#201617",
        },
        {
          reference: "Free Resources",
          text: "Want to explore life\u2019s biggest questions?",
          ctaLabel: "Join Our Bible Study",
          ctaLink: BSF_CTA,
          imageUrl: unsplash("photo-1650658720644-e1588bd66de3"),
          backgroundColor: "#5F4C5E",
        },
      ],
    }),
  }

  // ── 9. New Believer Course ────────────────────────────────────────────

  const nbcSection = {
    __component: "sections.section" as const,
    sectionKey: "new-believer-course",
    backgroundColor: "primary" as const,
    dynamicBackgroundImage: false,
    staticOverlay: true,
    content: [
      {
        __component: "sections.video-carousel" as const,
        sectionKey: "new-believer-course-carousel",
        subtitle: "Video Course",
        title: "New Believer Course",
        description:
          "If you\u2019ve ever wondered what Christianity is about, or what sort of lifestyle it empowers you to live, the New Believer Course exists to help you understand the Gospel and live your life in response to it.",
        items: nbcEpisodes.map((ep, i) => ({
          video: nbcIds[i],
          streamingUrl: nbcMuxUrls[i],
          imageUrl: imgCinematic(nbcImgs[i]),
          backgroundColor: "#1C160B",
          titleOverride: ep.title,
        })),
      },
    ],
  }

  // ── 10. Invitation to Know Jesus ──────────────────────────────────────

  const invitationSection = {
    __component: "sections.section" as const,
    sectionKey: "invitation-section",
    backgroundColor: "dark" as const,
    staticOverlay: false,
    content: buildVideoSectionContent({
      sectionKey: "invitation-to-know-jesus/english",
      videoId: invitationVideo.id,
      streamingUrl: MUX.invitationToKnowJesus,
      title: "Invitation to Know Jesus Personally",
      subtitle: "Are you ready to make the next step of faith?",
      textSubtitle: "Are you ready to make the next step of faith?",
      textHeading: "Invitation to Know Jesus Personally",
      description: [
        "The invitation is open to everyone. It means turning to God and trusting Jesus with our lives and to forgive our sins. We can speak to Him in prayer when we\u2019re ready to become followers of Jesus.",
      ],
      questions: [
        {
          question: "Why do I need saving if I'm a good person?",
          answer:
            "The Bible teaches that all have sinned and fall short of God\u2019s standard. No amount of good deeds can bridge the gap\u2014only God\u2019s grace through Jesus can.",
        },
        {
          question: "Why did Jesus have to die? Couldn't God just forgive us?",
          answer:
            "God\u2019s justice requires that sin be paid for. Jesus willingly took that payment upon Himself so that God could both be just and forgive those who believe.",
        },
        {
          question:
            "If Jesus rose from the dead, why doesn't everyone believe in Him?",
          answer:
            "Faith is a personal response to God\u2019s invitation. God gives everyone the freedom to choose, and the evidence is available for those who seek it sincerely.",
        },
      ],
      bibleQuotes: [
        {
          reference: "Isaiah 9:6",
          attribution: "Prophet Isaiah",
          text: "For to us a child is born, to us a son is given, and the government will be on his shoulders. And he will be called Wonderful Counselor, Mighty God, Everlasting Father, Prince of Peace.",
          imageUrl: unsplash("photo-1521106581851-da5b6457f674"),
          backgroundColor: "#1A1815",
        },
        {
          reference: "Romans 6:23",
          attribution: "Apostle Paul",
          text: "For the wages of sin is death, but the gift of God is eternal life in Christ Jesus our Lord.",
          imageUrl: unsplash("photo-1678181896030-11cf0237d704"),
          backgroundColor: "#72593A",
        },
        {
          reference: "Revelation 3:20",
          attribution: "Jesus",
          text: "Here I am! I stand at the door and knock. If anyone hears my voice and opens the door, I will come in and eat with that person, and they with me.",
          imageUrl: unsplash("photo-1508558936510-0af1e3cccbab", 1400),
          backgroundColor: "#201617",
        },
        {
          reference: "Free Resources",
          text: "Want to deepen your understanding of Jesus\u2019 life?",
          ctaLabel: "Join Our Bible Study",
          ctaLink: BSF_CTA,
          imageUrl: unsplash("photo-1650658720644-e1588bd66de3"),
          backgroundColor: "#5F4C5E",
        },
      ],
    }),
  }

  // ── Assemble in production order ──────────────────────────────────────

  try {
    await experienceService.create({
      locale: DEFAULT_LOCALE,
      status: "published",
      data: {
        slug: CHRISTMAS_EXPERIENCE_SLUG,
        title: "Christmas",
        metaDescription: `Christmas ${CURRENT_YEAR} \u2014 the story of Jesus' birth through film, scripture, and reflection`,
        pathSegment: "christmas",
        blocks: [
          heroBlock,
          mainSection,
          collectionSection,
          maryElizabethSection,
          birthShepherdsSection,
          magiSection,
          incarnationSection,
          storySection,
          nbcSection,
          invitationSection,
        ],
      },
    })
    strapi.log.info(
      `[seed-christmas] Created Experience "${CHRISTMAS_EXPERIENCE_SLUG}" with all sections.`,
    )
  } catch (error) {
    strapi.log.error(
      `[seed-christmas] Failed to create Experience "${CHRISTMAS_EXPERIENCE_SLUG}":`,
      error,
    )
    throw error
  }
}
