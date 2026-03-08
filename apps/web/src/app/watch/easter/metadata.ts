/**
 * SEO and social metadata for /watch/easter.
 * Source: CMS (Strapi Experience) per locale; falls back to static strings when CMS has no data.
 * See apps/web/docs/metadata-scaling.md for scaling to 2000+ languages.
 */

import { getWatchExperience, experienceToMetadata } from "@/lib/content"

const EASTER_SLUG = "easter"
const SITE_BASE = "https://www.jesusfilm.org"
const EASTER_BASE_PATH = "/watch/easter"
const TITLE_SUFFIX = "| Jesus Film Project"

/** Map app locale to Open Graph locale (e.g. en -> en_US). */
const OG_LOCALES: Record<string, string> = {
  en: "en_US",
  es: "es_ES",
  fr: "fr_FR",
  pt: "pt_BR",
  de: "de_DE",
}

const DEFAULT_OG_IMAGE = {
  url: "https://images.unsplash.com/photo-1482424917728-d82d29662023?w=1400&auto=format&fit=crop&q=60&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MjN8fGNocmlzdHxlbnwwfHwwfHx8MA%3D%3D",
  width: 1400,
  height: 933,
  alt: "Easter - Jesus Film Project",
  type: "image/jpeg" as const,
}

/** Static fallback when CMS has no metadata for this locale. */
const FALLBACK_META: Record<
  string,
  {
    title: string
    description: string
    ogTitle: string
    ogDescription: string
    pathSegment: string
  }
> = {
  en: {
    title: `Easter 2025 videos & resources about Lent, Holy Week, Resurrection ${TITLE_SUFFIX}`,
    description:
      "Explore the other side of Easter — one filled with betrayal, hope, and a claim that changed the world.",
    ogTitle:
      "What If Everything You Thought About Easter Is Only Half the Story?",
    ogDescription:
      "Explore the other side of Easter — one filled with betrayal, hope, and a claim that changed the world.",
    pathSegment: "",
  },
  es: {
    title: `Pascua 2025 videos y recursos sobre Cuaresma, Semana Santa, Resurrección ${TITLE_SUFFIX}`,
    description:
      "Explora el otro lado de la Pascua — lleno de traición, esperanza y una afirmación que cambió el mundo.",
    ogTitle:
      "What If Everything You Thought About Easter Is Only Half the Story?",
    ogDescription:
      "Explora el otro lado de la Pascua — lleno de traición, esperanza y una afirmación que cambió el mundo.",
    pathSegment: "spanish-latin-american",
  },
  fr: {
    title: `Pâques 2025 - vidéos et ressources sur le Carême, la Semaine Sainte, la Résurrection ${TITLE_SUFFIX}`,
    description:
      "Explorez l'autre côté de Pâques — une histoire de trahison, d'espérance et d'une affirmation qui a changé le monde.",
    ogTitle:
      "What If Everything You Thought About Easter Is Only Half the Story?",
    ogDescription:
      "Explorez l'autre côté de Pâques — une histoire de trahison, d'espérance et d'une affirmation qui a changé le monde.",
    pathSegment: "french",
  },
  pt: {
    title: `Vídeos e recursos da Páscoa 2025 sobre Quaresma, Semana Santa e Ressurreição ${TITLE_SUFFIX}`,
    description:
      "Explore o outro lado da Páscoa — repleto de traição, esperança e uma afirmação que mudou o mundo.",
    ogTitle:
      "What If Everything You Thought About Easter Is Only Half the Story?",
    ogDescription:
      "Explore o outro lado da Páscoa — repleto de traição, esperança e uma afirmação que mudou o mundo.",
    pathSegment: "portuguese-brazil",
  },
  de: {
    title: `Ostern 2025 – Videos und Ressourcen zu Fastenzeit, Karwoche und Auferstehung ${TITLE_SUFFIX}`,
    description:
      "Entdecken Sie die andere Seite von Ostern – eine Geschichte von Verrat, Hoffnung und einer Behauptung, die die Welt verändert hat.",
    ogTitle:
      "What If Everything You Thought About Easter Is Only Half the Story?",
    ogDescription:
      "Entdecken Sie die andere Seite von Ostern – eine Geschichte von Verrat, Hoffnung und einer Behauptung, die die Welt verändert hat.",
    pathSegment: "german",
  },
}

function getFallbackMeta(locale: string) {
  return FALLBACK_META[locale] ?? FALLBACK_META.en
}

function buildEasterUrl(pathSegment: string | null): string {
  const segment = pathSegment ?? ""
  return segment
    ? `${SITE_BASE}${EASTER_BASE_PATH}/${segment}`
    : `${SITE_BASE}${EASTER_BASE_PATH}`
}

/** Builds Next.js Metadata for /watch/easter from CMS or static fallback. Uses same getWatchExperience call as the page (cached). */
export async function getEasterMetadata(locale: string) {
  const result = await getWatchExperience(locale, { slug: EASTER_SLUG })
  const cms = result.data ? experienceToMetadata(result.data) : null
  const meta = cms ?? getFallbackMeta(locale)
  const pathSegment = cms?.pathSegment ?? getFallbackMeta(locale).pathSegment
  const url = buildEasterUrl(pathSegment ?? null)
  const fbAppId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID

  const ogImage = cms?.ogImage
    ? {
        url: cms.ogImage.url,
        width: cms.ogImage.width ?? DEFAULT_OG_IMAGE.width,
        height: cms.ogImage.height ?? DEFAULT_OG_IMAGE.height,
        alt: cms.ogImage.alt || DEFAULT_OG_IMAGE.alt,
        type: "image/jpeg" as const,
      }
    : DEFAULT_OG_IMAGE

  return {
    title: meta.title,
    description: meta.description,
    openGraph: {
      title: meta.ogTitle,
      description: meta.ogDescription,
      url,
      siteName: "Jesus Film Project",
      locale: OG_LOCALES[locale] ?? "en_US",
      type: "website" as const,
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image" as const,
      site: "@JesusFilm",
      creator: "@JesusFilm",
    },
    ...(fbAppId && { other: { "fb:app_id": fbAppId } }),
    alternates: {
      canonical: url,
    },
  }
}
