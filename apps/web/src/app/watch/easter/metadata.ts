/**
 * SEO and social metadata for /watch/easter.
 * Reference: Watch Easter Page — Metadata Reference (Jesus Film Project).
 */

const SITE_BASE = "https://www.jesusfilm.org"
const EASTER_BASE_PATH = "/watch/easter"
const TITLE_SUFFIX = "| Jesus Film Project"

const OG_IMAGE = {
  url: "https://images.unsplash.com/photo-1482424917728-d82d29662023?w=1400&auto=format&fit=crop&q=60&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MjN8fGNocmlzdHxlbnwwfHwwfHx8MA%3D%3D",
  width: 1400,
  height: 933,
  alt: "Easter - Jesus Film Project",
  type: "image/jpeg" as const,
}

/** Locale code (from getLocale) to URL path segment for og:url. Empty = base index. */
const LOCALE_PATH_SEGMENTS: Record<string, string> = {
  en: "", // base index: /watch/easter
  es: "spanish-latin-american",
  fr: "french",
  pt: "portuguese-brazil",
  de: "german",
  ru: "russian",
}

export type EasterLocaleMeta = {
  defaultTitle: string
  description: string
  ogTitle: string
  ogDescription: string
}

const LOCALE_METADATA: Record<string, EasterLocaleMeta> = {
  en: {
    defaultTitle: `Easter 2025 videos & resources about Lent, Holy Week, Resurrection ${TITLE_SUFFIX}`,
    description:
      "Explore the other side of Easter — one filled with betrayal, hope, and a claim that changed the world.",
    ogTitle:
      "What If Everything You Thought About Easter Is Only Half the Story?",
    ogDescription:
      "Explore the other side of Easter — one filled with betrayal, hope, and a claim that changed the world.",
  },
  es: {
    defaultTitle: `Pascua 2025 videos y recursos sobre Cuaresma, Semana Santa, Resurrección ${TITLE_SUFFIX}`,
    description:
      "Explora el otro lado de la Pascua — lleno de traición, esperanza y una afirmación que cambió el mundo.",
    ogTitle:
      "What If Everything You Thought About Easter Is Only Half the Story?",
    ogDescription:
      "Explora el otro lado de la Pascua — lleno de traición, esperanza y una afirmación que cambió el mundo.",
  },
  fr: {
    defaultTitle: `Pâques 2025 - vidéos et ressources sur le Carême, la Semaine Sainte, la Résurrection ${TITLE_SUFFIX}`,
    description:
      "Explorez l'autre côté de Pâques — une histoire de trahison, d'espérance et d'une affirmation qui a changé le monde.",
    ogTitle:
      "What If Everything You Thought About Easter Is Only Half the Story?",
    ogDescription:
      "Explorez l'autre côté de Pâques — une histoire de trahison, d'espérance et d'une affirmation qui a changé le monde.",
  },
  pt: {
    defaultTitle: `Vídeos e recursos da Páscoa 2025 sobre Quaresma, Semana Santa e Ressurreição ${TITLE_SUFFIX}`,
    description:
      "Explore o outro lado da Páscoa — repleto de traição, esperança e uma afirmação que mudou o mundo.",
    ogTitle:
      "What If Everything You Thought About Easter Is Only Half the Story?",
    ogDescription:
      "Explore o outro lado da Páscoa — repleto de traição, esperança e uma afirmação que mudou o mundo.",
  },
  de: {
    defaultTitle: `Ostern 2025 – Videos und Ressourcen zu Fastenzeit, Karwoche und Auferstehung ${TITLE_SUFFIX}`,
    description:
      "Entdecken Sie die andere Seite von Ostern – eine Geschichte von Verrat, Hoffnung und einer Behauptung, die die Welt verändert hat.",
    ogTitle:
      "What If Everything You Thought About Easter Is Only Half the Story?",
    ogDescription:
      "Entdecken Sie die andere Seite von Ostern – eine Geschichte von Verrat, Hoffnung und einer Behauptung, die die Welt verändert hat.",
  },
  ru: {
    defaultTitle: `Пасха 2025: видео и материалы о Великом посте, Страстной неделе, Воскресении ${TITLE_SUFFIX}`,
    description:
      "Откройте для себя другую сторону Пасхи — историю, наполненную предательством, надеждой и утверждением, изменившим мир.",
    ogTitle:
      "What If Everything You Thought About Easter Is Only Half the Story?",
    ogDescription:
      "Откройте для себя другую сторону Пасхи — историю, наполненную предательством, надеждой и утверждением, изменившим мир.",
  },
}

function getMetaForLocale(locale: string): EasterLocaleMeta {
  return LOCALE_METADATA[locale] ?? LOCALE_METADATA.en
}

function getEasterUrl(locale: string): string {
  const segment = LOCALE_PATH_SEGMENTS[locale] ?? ""
  return segment
    ? `${SITE_BASE}${EASTER_BASE_PATH}/${segment}`
    : `${SITE_BASE}${EASTER_BASE_PATH}`
}

export function getEasterMetadata(locale: string) {
  const meta = getMetaForLocale(locale)
  const url = getEasterUrl(locale)
  const fbAppId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID

  return {
    title: meta.defaultTitle,
    description: meta.description,
    openGraph: {
      title: meta.ogTitle,
      description: meta.ogDescription,
      url,
      siteName: "Jesus Film Project",
      locale: "en_US",
      type: "website" as const,
      images: [OG_IMAGE],
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
