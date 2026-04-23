export type Platform = "web" | "mobile"

export type PlatformOrdering = {
  web: number[]
  mobile: number[]
}

export type VideoRef = {
  id: number
  documentId: string
  title: string
  slug: string
  streamingUrl: string
  thumbnailUrl?: string
}

export type VideoSection = {
  __component: "sections.video"
  sectionKey: string
  video: number
  streamingUrl: string
  title: string
  subtitle: string
  videoRef?: VideoRef
}

export type VideoHeroSection = {
  __component: "sections.video-hero"
  sectionKey: string
  streamingUrl: string
  heading: string
  ctaLabel?: string
  ctaLink?: string
  videoRef?: VideoRef
}

export type VideoCarouselItem = {
  sectionKey: string
  video: number
  streamingUrl: string
  title: string
  subtitle?: string
  videoRef?: VideoRef
}

export type VideoCarouselSection = {
  __component: "sections.video-carousel"
  title: string
  subtitle?: string
  description?: string
  sectionKey: string
  items: VideoCarouselItem[]
}

export type TextSection = {
  __component: "sections.text"
  heading?: string
  subtitle?: string
  contentParagraphs: string[]
}

export type ContainerSlot = {
  gridSpan: number
  content: SectionBlock[]
}

export type ContainerSection = {
  __component: "sections.container"
  slots: ContainerSlot[]
}

export type RelatedQuestion = {
  question: string
  answer: string
}

export type RelatedQuestionsSection = {
  __component: "sections.related-questions"
  heading: string
  ctaLabel?: string
  ctaLink?: string
  questions: RelatedQuestion[]
}

export type BibleQuote = {
  reference: string
  text: string
  attribution?: string
  imageUrl: string
  backgroundColor: string
  ctaLabel?: string
  ctaLink?: string
}

export type BibleQuotesCarouselSection = {
  __component: "sections.bible-quotes-carousel"
  heading: string
  sectionKey: string
  quotes: BibleQuote[]
}

export type QuizButtonSection = {
  __component: "sections.quiz-button"
  buttonText: string
  iframeSrc: string
}

export type SectionBlock =
  | VideoSection
  | VideoHeroSection
  | VideoCarouselSection
  | TextSection
  | ContainerSection
  | RelatedQuestionsSection
  | BibleQuotesCarouselSection
  | QuizButtonSection

export type GeneratedExperience = {
  title: string
  slug: string
  metaDescription?: string
  blocks: SectionBlock[]
  platformOrdering: PlatformOrdering
}

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  experienceSnapshot?: GeneratedExperience
  suggestions?: string[]
}
