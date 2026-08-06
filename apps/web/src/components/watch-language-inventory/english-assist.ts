export const ENGLISH_ASSIST_COPY = {
  chooseLanguage: "Choose a language collection",
  closeHelp: "Close English help",
  guideDescription:
    "Use these English labels to navigate this localized video collection.",
  guideTitle: "English navigation help",
  labelBibleProject: "BibleProject collections",
  labelCollections: "Collections with dubbed videos",
  labelItemCount: "Items in this section",
  labelLanguageCollection: "Language collection",
  labelSports: "Sports videos",
  labelSubtitlesOnly: "Videos with subtitles and no dubbed audio",
  labelVideoBible: "Video Bible collections",
  nextSection: "Show the next section",
  openCollection: "Open collection",
  openHelp: "Open English help",
  openVideo: "Open video",
  previousSection: "Show the previous section",
  sectionBibleProject: "Go to BibleProject",
  sectionCollections: "Go to collections",
  sectionNew: "Go to new releases",
  sectionSports: "Go to sports videos",
  sectionSubtitlesOnly: "Go to subtitles-only videos",
  sectionVideoBible: "Go to Video Bible",
  stateAudio: "Dubbed audio is available",
  stateNew: "Recently added in this language",
  stateNewestFirst: "Videos are ordered from newest to oldest",
  stateSubtitles: "Subtitles are available",
  stateSubtitlesOnly: "Subtitles are available without dubbed audio",
} as const

export type EnglishAssistToken = keyof typeof ENGLISH_ASSIST_COPY

export function englishAssistText(token: string): string | null {
  return Object.prototype.hasOwnProperty.call(ENGLISH_ASSIST_COPY, token)
    ? ENGLISH_ASSIST_COPY[token as EnglishAssistToken]
    : null
}

export function englishAssistAttributes(token: EnglishAssistToken) {
  return {
    "data-english-assist": token,
    title: ENGLISH_ASSIST_COPY[token],
  } as const
}
