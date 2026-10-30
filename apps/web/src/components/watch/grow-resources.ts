// Real data for the original "Grow in faith" presentation, ported from the
// read-only prototype (gathered 2026-09-17/18 from jesusfilm.org, bible.com and
// the Watch library itself). Plans and the prayer guide's requests are the
// target's checked copies in `@/lib/watch-grow-content`, re-exported here so
// the two never drift; everything else is the prototype's sourced data.
//
// Provenance, per block:
//  - GROW_PLANS           bible.com/organizations/61adf7f8-… (the Jesus Film
//                         Project publisher page). Titles and numeric plan ids
//                         are theirs; the "lane" grouping is ours.
//  - FOLLOW_UP_STEPS      Episodes of "Walking with Jesus (Africa)" as they sit
//                         in our own Watch library, matched to Cru's Follow-Up
//                         Series booklet subtitles ("Stepping from … to …").

import { WATCH_GROW_PRAYER } from "@/lib/watch-grow-content"

export {
  GROW_PLANS,
  GROW_PLAN_LANES,
  type GrowPlan,
} from "@/lib/watch-grow-content"

export type FollowUpStep = {
  title: string
  /** Cru's Follow-Up Series booklet subtitle for this step. */
  step: string
  /** Episode runtime as published on the Watch page. */
  runtime: string
  href: string
}

/**
 * "Walking with Jesus (Africa)" — five episodes we already host, in order.
 * Series blurb on the collection page: a mini-series to help new followers of
 * Jesus develop their faith through scenarios depicting African life.
 */
export const FOLLOW_UP_STEPS: FollowUpStep[] = [
  {
    title: "Assurance of Salvation",
    step: "From uncertainty to confidence",
    runtime: "24:26",
    href: "https://www.jesusfilm.org/watch/walking-with-jesus-africa.html/assurance-of-salvation.html",
  },
  {
    title: "Fellowship of Believers",
    step: "From alone to belonging",
    runtime: "25:36",
    href: "https://www.jesusfilm.org/watch/walking-with-jesus-africa.html/fellowship-of-believers.html",
  },
  {
    title: "The Holy Spirit",
    step: "From unable to empowered",
    runtime: "16:22",
    href: "https://www.jesusfilm.org/watch/walking-with-jesus-africa.html/the-holy-spirit.html",
  },
  {
    title: "Walking in the Spirit",
    step: "From unprepared to equipped",
    runtime: "24:26",
    href: "https://www.jesusfilm.org/watch/walking-with-jesus-africa.html/walking-in-the-spirit.html",
  },
  {
    title: "Growing in Christ",
    step: "From undeveloped to maturity",
    runtime: "29:17",
    href: "https://www.jesusfilm.org/watch/walking-with-jesus-africa.html/growing-in-christ.html",
  },
]

export const FOLLOW_UP_SERIES_HREF =
  "https://www.jesusfilm.org/watch/walking-with-jesus-africa.html"

/* ---------------------------------------------------------------------------
   G5 — this month's prayer guide. Country, facts and the seven day-requests
   below are transcribed from the real September 2026 PDF (the "For the Least
   Reached: A Year of Prayer" series), linked underneath.
--------------------------------------------------------------------------- */

export const PRAYER_MONTH = {
  month: "September 2026",
  country: "Bangladesh",
  /** ISO 3166-1 alpha-2 — the flag emoji is derived from it. */
  countryCode: "BD",
  /** Pulled from the guide's own "Did you know?" and intro pages. */
  facts: [
    "Over 170 million people — in a country the size of Iowa.",
    "Bengali is spoken by about 99%; around 40 other languages are spoken too.",
    "The Jesus Film Project app carries media in 38 of those languages.",
    "Called the Land of Rivers — about 700 of them flow through it.",
  ],
  /** All 31 daily requests, transcribed from the real September 2026 PDF. */
  days: WATCH_GROW_PRAYER.requests,
  /** The twelve least-reached countries this year's series prays through. */
  countries: [
    "Bangladesh",
    "China",
    "Egypt",
    "India",
    "Indonesia",
    "Iran",
    "Japan",
    "Pakistan",
    "Russia",
    "Thailand",
    "Turkey",
    "Vietnam",
  ],
  /** The guide's own headline: those twelve hold 3.6 billion unreached people. */
  reach:
    "3.6 billion people — nearly all of the world's unreached — live in these twelve countries.",
  pdf: WATCH_GROW_PRAYER.pdf,
  /** The archive page the target re-checked on 2026-10-17. */
  hub: WATCH_GROW_PRAYER.hub,
} as const

/* Week openers from the guide: its own photograph and the verse printed on it.
   The images are extracted straight out of the September 2026 PDF and live in
   public/images/prototype-prayer — under /images because `src/proxy.ts` lets
   that prefix through untouched, and prefixed with the app's /watch basePath
   because the image optimizer fetches the src exactly as written. */
export type PrayerWeek = {
  n: number
  /** The day this week opens on. */
  startsOn: number
  verse: string
  reference: string
  image: string
}

export const PRAYER_WEEKS: PrayerWeek[] = [
  {
    n: 1,
    startsOn: 1,
    verse:
      "The Lord is not slow in keeping His promise, as some understand slowness. Instead He is patient with you, not wanting anyone to perish, but everyone to come to repentance.",
    reference: "2 Peter 3:9 · NIV",
    image: "/watch/images/prototype-prayer/week-1.jpg",
  },
  {
    n: 2,
    startsOn: 8,
    verse:
      "Come to Me, all you who are weary and burdened, and I will give you rest.",
    reference: "Matthew 11:28 · NIV",
    image: "/watch/images/prototype-prayer/week-2.jpg",
  },
  {
    n: 3,
    startsOn: 15,
    verse:
      "For God so loved the world that He gave His one and only Son, that whoever believes in Him shall not perish but have eternal life.",
    reference: "John 3:16 · NIV",
    image: "/watch/images/prototype-prayer/week-3.jpg",
  },
  {
    n: 4,
    startsOn: 22,
    verse:
      "Let all the earth fear the Lord; let all the people of the world revere Him.",
    reference: "Psalm 33:8 · NIV",
    image: "/watch/images/prototype-prayer/week-4.jpg",
  },
  {
    n: 5,
    startsOn: 29,
    verse:
      "How, then, can they call on the One they have not believed in? And how can they believe in the One of whom they have not heard?",
    reference: "Romans 10:14 · NIV",
    image: "/watch/images/prototype-prayer/week-5.jpg",
  },
]

/** Assets lifted from the guide itself. */
export const PRAYER_ART = {
  /** The guide's cover photograph on its own — no baked gradients, no baked
      map (the wash is CSS, the map is SVG). Extended downward so it fills the
      whole block: the last rows are stretched, blurred hard and ramped into the
      card's own near-black, so she falls into shadow behind the carousel
      instead of being stretched or mirrored. */
  banner: "/watch/images/prototype-prayer/girl-tall.jpg",
  cover: "/watch/images/prototype-prayer/cover.jpg",
  map: "/watch/images/prototype-prayer/map-east.png",
  facts: [
    "/watch/images/prototype-prayer/fact-1.jpg",
    "/watch/images/prototype-prayer/fact-2.jpg",
  ],
} as const

/* The languages people actually speak in this month's country, from Admin's own
   country/language catalogue (speaker counts are theirs), each with a REAL
   JESUS page in that language — every URL below was probed and returned 200.
   Harvested 2026-09-18. */
export type PrayerLanguage = {
  name: string
  /** Speakers in-country, as Admin records them. */
  speakers: number
  href: string
  /* The language's own name in its own script. Sourced, not transliterated by
     me: Admin's own `name` map where it carries one (Bangla, Garo), otherwise
     Wikidata's native-label (P1705) or the English Wikipedia infobox
     `native_name`, read 2026-09-18. Marma has no sourced native form in either
     — it is left off rather than invented. */
  native?: string
}

export const PRAYER_LANGUAGES: PrayerLanguage[] = [
  {
    name: "Bangla",
    native: "বাংলা",
    speakers: 133000000,
    href: "https://www.jesusfilm.org/watch/jesus.html/bangla-muslim.html",
  },
  {
    name: "Chittagonian",
    native: "চাটগাঁইয়া",
    speakers: 12500000,
    href: "https://www.jesusfilm.org/watch/jesus.html/chatgaya-chittagonian-muslim.html",
  },
  {
    name: "Rangpuria",
    native: "রংপুরী",
    speakers: 10000000,
    href: "https://www.jesusfilm.org/watch/jesus.html/rangpuria-bangla.html",
  },
  {
    name: "Sylheti",
    native: "ꠍꠤꠟꠐꠤ",
    speakers: 7000000,
    href: "https://www.jesusfilm.org/watch/jesus.html/sylheti.html",
  },
  {
    name: "Chakma",
    native: "𑄌𑄋𑄴𑄟𑄳𑄦",
    speakers: 483000,
    href: "https://www.jesusfilm.org/watch/jesus.html/chakma.html",
  },
  {
    name: "Santali",
    native: "ᱥᱟᱱᱛᱟᱲᱤ",
    speakers: 225000,
    href: "https://www.jesusfilm.org/watch/jesus.html/santali-india.html",
  },
  {
    name: "Marma",
    speakers: 224000,
    href: "https://www.jesusfilm.org/watch/jesus.html/marma.html",
  },
  {
    name: "Rohingya",
    native: "𐴌𐴟𐴇𐴝𐴙𐴚𐴒𐴙𐴝",
    speakers: 200000,
    href: "https://www.jesusfilm.org/watch/jesus.html/rohingya.html",
  },
  {
    name: "Garo",
    native: "গারো",
    speakers: 120000,
    href: "https://www.jesusfilm.org/watch/jesus.html/garo.html",
  },
]

/** Admin lists 39 languages for Bangladesh; these are the ones shown. */
export const PRAYER_LANGUAGE_TOTAL = 39

/* Sponsoring a translation is a real Jesus Film Project project: Mission 865
   funds "JESUS" in the last 865 language groups of 50,000+ speakers that still
   have no film in their heart language. Both URLs probed 200 on 2026-09-18 —
   the give URL is the site's own Mission 865 designation (2867071). */
export const PRAYER_SPONSOR = {
  give: "https://www.jesusfilm.org/how-to-help/ways-to-donate/give-now/?amount=&frequency=single&campaign-code=NXWJFP&designation-number=2867071",
  about:
    "https://www.jesusfilm.org/give/ways-to-give/current-projects/mission-865/",
  /** Language groups still waiting, per Mission 865 itself. */
  groups: 865,
}

/* The family edition of the prayer guide: the newest real file on the prayer
   hub when the prototype was built (its partner-resources list, first entry). */
export const PRAYER_FAMILY_GUIDE = {
  title: "September 2025",
  url: "https://www.jesusfilm.org/wp-content/uploads/2025/08/JFP-Pray-Family-2025-09.pdf",
  image:
    "https://www.jesusfilm.org/wp-content/uploads/2025/08/2025-prayer-family-09.jpg",
} as const

/** The printed Beginning With Jesus guide, for when the course cannot load.
    Same file as `BWJ.pdf`, kept here so the light shelf need not import the
    curriculum. */
export const BWJ_SOURCE_PDF =
  "https://www.jesusfilm.org/wp-content/uploads/2026/03/Beginning-With-Jesus.pdf"
