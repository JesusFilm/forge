/**
 * Context-aware suggested prompts for the experience chat panel.
 *
 * Pure function: given canvas state + locale, returns 4–6 prompts.
 * Empty canvas → creation-focused prompts.
 * Populated canvas → refinement-focused prompts.
 *
 * Locales not in the static map fall back to `en`.
 */

export type SuggestedPromptContext = {
  canvasState: "empty" | "populated"
  locale: string
}

type PromptSet = {
  empty: readonly string[]
  populated: readonly string[]
}

const PROMPTS: Record<string, PromptSet> = {
  en: {
    empty: [
      "Create an experience for grieving teens",
      "Build something about forgiveness with a video hero",
      "Draft an experience for new believers, gentle tone",
      "Make an experience around prayer for difficult times",
      "Create a guided reflection on doubt and faith",
    ],
    populated: [
      "Make the hero punchier",
      "Soften the CTA tone",
      "Add a reflection section after the video",
      "Swap the hero video for one about hope",
      "Rewrite the body copy in a younger voice",
    ],
  },
  es: {
    empty: [
      "Crea una experiencia para adolescentes en duelo",
      "Construye algo sobre el perdón con un video principal",
      "Redacta una experiencia para nuevos creyentes, en tono amable",
      "Haz una experiencia sobre la oración en momentos difíciles",
      "Crea una reflexión guiada sobre la duda y la fe",
    ],
    populated: [
      "Haz el encabezado más contundente",
      "Suaviza el tono de la llamada a la acción",
      "Agrega una sección de reflexión después del video",
      "Cambia el video principal por uno sobre la esperanza",
      "Reescribe el cuerpo del texto con una voz más juvenil",
    ],
  },
  fr: {
    empty: [
      "Crée une expérience pour les adolescents en deuil",
      "Construis quelque chose sur le pardon avec une vidéo en accroche",
      "Rédige une expérience pour les nouveaux croyants, ton bienveillant",
      "Fais une expérience autour de la prière dans les moments difficiles",
      "Crée une réflexion guidée sur le doute et la foi",
    ],
    populated: [
      "Rends l'accroche plus percutante",
      "Adoucis le ton de l'appel à l'action",
      "Ajoute une section de réflexion après la vidéo",
      "Remplace la vidéo principale par une sur l'espérance",
      "Réécris le corps du texte avec une voix plus jeune",
    ],
  },
}

const FALLBACK_LOCALE = "en"

function resolvePromptSet(locale: string): PromptSet {
  // Try exact match, then language subtag (e.g. "en-US" → "en"), then fallback.
  if (PROMPTS[locale]) return PROMPTS[locale]
  const primary = locale.split("-")[0]?.toLowerCase()
  if (primary && PROMPTS[primary]) return PROMPTS[primary]
  return PROMPTS[FALLBACK_LOCALE]!
}

export function getSuggestedPrompts(
  ctx: SuggestedPromptContext,
): readonly string[] {
  const set = resolvePromptSet(ctx.locale)
  return ctx.canvasState === "empty" ? set.empty : set.populated
}
