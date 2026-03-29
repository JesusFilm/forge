/**
 * Section models for the Expo watch app.
 *
 * Mirrors the iOS section model hierarchy (SectionModels.swift,
 * SectionLeafModels.swift, SectionStructuralModels.swift) as TypeScript
 * interfaces and discriminated unions.
 */

// -- Shared media models ---------------------------------------------------

export interface UploadFileModel {
  url: string
  alternativeText: string | null
}

export interface VideoModel {
  documentId: string
  slug: string
  title: string
  image: UploadFileModel | null
}

// -- Enums -----------------------------------------------------------------

export type MediaCollectionVariant =
  | "carousel"
  | "collection"
  | "grid"
  | "hero"
  | "player"

export type CardVariant = "default" | "featured"

export type CTAVariant = "primary" | "secondary"

export type TextHeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6"

export type TextVariant = "default" | "lead" | "small"

export type SectionBackgroundColor = "default" | "light" | "dark" | "primary"

// -- Leaf section models ---------------------------------------------------

export interface MediaCollectionItem {
  id: string
  titleOverride: string | null
  subtitleOverride: string | null
  labelOverride: string | null
  collectionSize: string | null
  imageUrl: string | null
  linkToSectionKey: string | null
  imageOverride: UploadFileModel | null
  video: VideoModel | null
}

export interface MediaCollectionSection {
  kind: "mediaCollection"
  id: string
  sectionKey: string | null
  title: string | null
  subtitle: string | null
  description: string | null
  categoryLabel: string | null
  ctaLink: string | null
  showItemNumbers: boolean | null
  footerText: string | null
  variant: MediaCollectionVariant
  items: MediaCollectionItem[]
}

export interface CTASection {
  kind: "cta"
  id: string
  sectionKey: string | null
  heading: string | null
  body: string | null
  buttonLabel: string
  buttonLink: string | null
  variant: CTAVariant | null
}

export interface VideoHeroSection {
  kind: "videoHero"
  id: string
  sectionKey: string | null
  heading: string | null
  subheading: string | null
  streamingUrl: string | null
  ctaLink: string | null
  ctaLabel: string | null
  video: VideoModel
}

export interface TextSection {
  kind: "text"
  id: string
  sectionKey: string | null
  heading: string | null
  headingLevel: TextHeadingLevel | null
  subtitle: string | null
  content: string
  variant: TextVariant | null
}

export interface RelatedQuestionItem {
  id: string
  question: string
  answer: string
}

export interface RelatedQuestionsSection {
  kind: "relatedQuestions"
  id: string
  sectionKey: string | null
  heading: string | null
  questions: RelatedQuestionItem[]
}

export interface BibleQuoteItem {
  id: string
  reference: string
  text: string
  /** @deprecated Use imageUrl instead. Retained as fallback during CMS content migration. */
  backgroundImage: UploadFileModel | null
  imageUrl: string | null
  backgroundColor: string | null
  ctaLabel: string | null
  ctaLink: string | null
  attribution: string | null
}

export interface BibleQuotesCarouselSection {
  kind: "bibleQuotesCarousel"
  id: string
  sectionKey: string | null
  heading: string | null
  quotes: BibleQuoteItem[]
}

export interface CardSection {
  kind: "card"
  id: string
  sectionKey: string | null
  title: string
  description: string
  media: UploadFileModel | null
  link: string | null
  variant: CardVariant | null
}

export interface VideoSection {
  kind: "video"
  id: string
  sectionKey: string | null
  streamingUrl: string
  title: string | null
  subtitle: string | null
  media: UploadFileModel | null
  video: VideoModel | null
}

export interface EasterDatesSection {
  kind: "easterDates"
  id: string
  sectionKey: string | null
  easterDatesTitle: string
  westernEasterLabel: string
  orthodoxEasterLabel: string
  passoverLabel: string
  locale: string | null
}

export interface NavigationCarouselItem {
  id: string
  contentId: string
  title: string
  category: string | null
  imageUrl: string | null
  backgroundColor: string | null
}

export interface NavigationCarouselSection {
  kind: "navigationCarousel"
  id: string
  sectionKey: string | null
  items: NavigationCarouselItem[]
}

export interface QuizButtonSection {
  kind: "quizButton"
  id: string
  sectionKey: string | null
  buttonText: string
  iframeSrc: string
}

// -- Structural section models ---------------------------------------------

export interface ContainerSlot {
  id: string
  gridSpan: number
  content: SectionContent[]
}

export interface ContainerSection {
  kind: "container"
  id: string
  sectionKey: string | null
  slots: ContainerSlot[]
}

export interface SectionWrapperSection {
  kind: "sectionWrapper"
  id: string
  sectionKey: string | null
  backgroundColor: SectionBackgroundColor | null
  blurHash: string | null
  content: SectionContent[]
}

// -- Union types -----------------------------------------------------------

/**
 * Content that can appear inside Container slots and Section wrappers.
 * Includes all 8 leaf types plus container (for Section → Container nesting).
 */
export type SectionContent =
  | MediaCollectionSection
  | CTASection
  | TextSection
  | RelatedQuestionsSection
  | BibleQuotesCarouselSection
  | CardSection
  | VideoSection
  | ContainerSection
  | EasterDatesSection
  | NavigationCarouselSection
  | QuizButtonSection

/**
 * Top-level section in an Experience. Discriminated by `kind`.
 * VideoHeroSection is top-level only — it cannot appear nested inside
 * Container slots or SectionWrapper content per the CMS schema.
 */
export type ExperienceSection =
  | SectionContent
  | VideoHeroSection
  | SectionWrapperSection
