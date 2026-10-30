// Data adapter for the original Partner presentation (WatchPartnerPromo,
// WatchPartnerResources, WatchGrowPrayer). The verified records — titles,
// summaries, page links and PDFs — come from `@/lib/watch-partner-resources`;
// this file only adds what the original cards need on top: the cover image each
// jesusfilm.org resource page already publishes, the original display order,
// and the original kind labels. The monthly prayer guides are direct
// jesusfilm.org PDF links read from /partners/resources/pray/ (2026-09-15).
// Nothing here is protected content.

import {
  WATCH_PARTNER_RESOURCES,
  type WatchPartnerResourceCategoryId,
} from "@/lib/watch-partner-resources"

export type PartnerResourceKind =
  | "Digital Strategies"
  | "Equipment"
  | "Outreach Resources"
  | "Prayer Resources"
  | "Training Strategies"

export type PartnerResource = {
  id: string
  title: string
  kind: PartnerResourceKind
  summary: string
  href: string
  image: string
  /** Direct PDF when the resource publishes one. */
  pdf?: string
}

const KIND_OF: Record<WatchPartnerResourceCategoryId, PartnerResourceKind> = {
  outreach: "Outreach Resources",
  training: "Training Strategies",
  digital: "Digital Strategies",
  equipment: "Equipment",
  prayer: "Prayer Resources",
}

/** Original display order, with each page's published cover image. */
const COVERS: readonly (readonly [id: string, image: string])[] = [
  ["26408", "https://www.jesusfilm.org/wp-content/uploads/2024/09/Tablets.jpg"],
  [
    "26358",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/Why-Intern-570.jpg",
  ],
  [
    "26354",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/AudioBible.jpg",
  ],
  [
    "26343",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/ProjectorSets.jpg",
  ],
  [
    "26370",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/BeginningW_Jesus.jpg",
  ],
  [
    "26368",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/ConsiderJesus.jpg",
  ],
  [
    "26366",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/DigitalEvangelismWebinar.jpg",
  ],
  [
    "26364",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/ShortFilmEvangelismTraining.jpg",
  ],
  [
    "26361",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/KnowingJesus.jpg",
  ],
  [
    "26360",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/NewLifeBoxKits.png",
  ],
  [
    "40403",
    "https://www.jesusfilm.org/wp-content/uploads/2026/04/84e2a1ac67e9185c0e973c89bb7e972722174ada.jpg",
  ],
  [
    "40404",
    "https://www.jesusfilm.org/wp-content/uploads/2026/04/98sd90f7123jkhr4jkhasd908.png",
  ],
  [
    "38489",
    "https://www.jesusfilm.org/wp-content/uploads/2026/02/MVPWorldCupPage-Color-compressed.png",
  ],
  [
    "35997",
    "https://www.jesusfilm.org/wp-content/uploads/2023/01/sots-hero.jpg",
  ],
  [
    "35993",
    "https://www.jesusfilm.org/wp-content/uploads/2025/10/GatherAndGrow.webp",
  ],
  ["31193", "https://www.jesusfilm.org/wp-content/uploads/2023/01/hero-8a.png"],
  [
    "26405",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/GatherAndGrow.jpg",
  ],
  [
    "26402",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/StoryOfTheSoul.jpg",
  ],
  [
    "26400",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/HostAMulti-LanguageOutreachUsingMagdalenaThroughHerEyes.jpg",
  ],
  [
    "26397",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/JesusKnowsYourName.jpg",
  ],
  [
    "26395",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/JourneyToJesus.jpg",
  ],
  [
    "26393",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/WTTW-Optimized570p-1.jpg",
  ],
  [
    "26391",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/StoriesInGraceSing.jpg",
  ],
  [
    "26379",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/HowToHostAShortFilmFestival.jpg",
  ],
  [
    "26377",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/UsingTheAmazingRaceToShareYourFaith.jpg",
  ],
  [
    "26372",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/ConversationalEnglishUsingShortFilms.jpg",
  ],
  [
    "39679",
    "https://www.jesusfilm.org/wp-content/uploads/2026/04/MetaverseToolkitThumbnail_compressed.png",
  ],
  [
    "35584",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/YouVersionReadingPlans.jpg",
  ],
  [
    "26389",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/NextSteps.jpg",
  ],
  [
    "26387",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/JesusFilmApp.jpg",
  ],
  ["26385", "https://www.jesusfilm.org/wp-content/uploads/2024/09/Watch.jpg"],
  [
    "26381",
    "https://www.jesusfilm.org/wp-content/uploads/2024/09/FTLRAYearOfPrayer.jpg",
  ],
]

export const PARTNER_RESOURCES: PartnerResource[] = COVERS.flatMap(
  ([id, image]) => {
    const record = WATCH_PARTNER_RESOURCES.find((r) => r.id === id)
    if (!record) return []
    return [
      {
        id,
        title: record.title,
        kind: KIND_OF[record.category],
        summary: record.summary,
        href: record.destination,
        image,
        ...(record.pdf ? { pdf: record.pdf } : {}),
      },
    ]
  },
)

/**
 * Real monthly prayer guides from /partners/resources/pray/.
 * `individual` carries the month + country focus from the page headings;
 * `family` carries the printed cover art WordPress links each PDF from.
 */
export type PrayerGuide = { title: string; url: string; image?: string }

export const PARTNER_PRAYER_GUIDES: PrayerGuide[] = [
  {
    title: "January 2026 – India",
    url: "https://www.jesusfilm.org/wp-content/uploads/2026/01/JFP-Prayer-Guide-2026-01.pdf",
  },
  {
    title: "February 2026 – Iran",
    url: "https://www.jesusfilm.org/wp-content/uploads/2026/01/JFP-Prayer-Guide-2026-02.pdf",
  },
  {
    title: "March 2026 – Pakistan",
    url: "https://www.jesusfilm.org/wp-content/uploads/2026/02/JFP-Prayer-Guide-2026-03.pdf",
  },
  {
    title: "April 2026 – China",
    url: "https://www.jesusfilm.org/wp-content/uploads/2026/03/JFP-Prayer-Guide-2026-04.pdf",
  },
  {
    title: "May 2026 – Japan",
    url: "https://www.jesusfilm.org/wp-content/uploads/2026/04/JFP-Prayer-Guide-2026-05.pdf",
  },
  {
    title: "June 2026 – Egypt",
    url: "https://www.jesusfilm.org/wp-content/uploads/2026/05/JFP-Prayer-Guide-2026-06.pdf",
  },
  {
    title: "July 2026 – Thailand",
    url: "https://www.jesusfilm.org/wp-content/uploads/2026/06/JFP-Prayer-Guide-2026-07.pdf",
  },
  {
    title: "August 2026 – Indonesia",
    url: "https://www.jesusfilm.org/wp-content/uploads/2026/07/JFP-Prayer-Guide-2026-08.pdf",
  },
  {
    title: "September 2026 – Bangladesh",
    url: "https://www.jesusfilm.org/wp-content/uploads/2026/08/JFP-Prayer-Guide-2026-09.pdf",
  },
  {
    title: "January 2025 – China",
    url: "https://www.jesusfilm.org/wp-content/uploads/2024/12/JFP-Prayer-Guide-2025-01.pdf",
  },
  {
    title: "February 2025 – Vietnam",
    url: "https://www.jesusfilm.org/wp-content/uploads/2025/01/JFP-Prayer-Guide-2025-02.pdf",
  },
  {
    title: "March 2025 – Iran",
    url: "https://www.jesusfilm.org/wp-content/uploads/2025/02/JFP-Prayer-Guide-2025-03.pdf",
  },
]

export const PARTNER_FAMILY_GUIDES: PrayerGuide[] = [
  {
    title: "September 2025",
    url: "https://www.jesusfilm.org/wp-content/uploads/2025/08/JFP-Pray-Family-2025-09.pdf",
    image:
      "https://www.jesusfilm.org/wp-content/uploads/2025/08/2025-prayer-family-09.jpg",
  },
  {
    title: "May 2025",
    url: "https://www.jesusfilm.org/wp-content/uploads/2025/04/JFP-Pray-Family-2025-05.pdf",
    image:
      "https://www.jesusfilm.org/wp-content/uploads/2025/04/2025-prayer-family-05.jpg",
  },
  {
    title: "January 2025",
    url: "https://www.jesusfilm.org/wp-content/uploads/2024/12/JFP-Pray-Family-2025-01.pdf",
    image:
      "https://www.jesusfilm.org/wp-content/uploads/2024/12/2025-prayer-family-01.jpg",
  },
  {
    title: "December 2024",
    url: "https://www.jesusfilm.org/wp-content/uploads/2024/11/JFP-Pray-Family-2024-12.pdf",
    image:
      "https://www.jesusfilm.org/wp-content/uploads/2024/11/2024-prayer-family-12.jpg",
  },
  {
    title: "November 2024",
    url: "https://www.jesusfilm.org/wp-content/uploads/2024/10/JFP-Pray-Family-2024-11.pdf",
    image:
      "https://www.jesusfilm.org/wp-content/uploads/2024/10/2024-prayer-family-11.jpg",
  },
  {
    title: "October 2024",
    url: "https://www.jesusfilm.org/wp-content/uploads/2024/09/JFP-Pray-Family-2024-10.pdf",
    image:
      "https://www.jesusfilm.org/wp-content/uploads/2024/09/2024-prayer-family-10.jpg",
  },
  {
    title: "August 2024",
    url: "https://www.jesusfilm.org/wp-content/uploads/2024/07/JFP-Pray-Family-2024-08.pdf",
    image:
      "https://www.jesusfilm.org/wp-content/uploads/2024/07/2024-prayer-family-08.jpg",
  },
  {
    title: "July 2024",
    url: "https://www.jesusfilm.org/wp-content/uploads/2024/06/JFP-Pray-Family-2024-07.pdf",
    image:
      "https://www.jesusfilm.org/wp-content/uploads/2024/06/2024-prayer-family-07.png",
  },
]
