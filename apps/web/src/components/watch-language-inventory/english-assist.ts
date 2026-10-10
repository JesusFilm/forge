export const ENGLISH_ASSIST_COPY = {
  chooseLanguage: "Choose a language collection",
  labelBibleProject: "BibleProject collections",
  labelCollections: "Collections with dubbed videos",
  labelItemCount: "Items in this section",
  labelLanguageCollection: "Language collection",
  labelSports: "Sports videos",
  labelSubtitlesOnly: "Videos with subtitles and no dubbed audio",
  labelVideoBible: "Video Bible collections",
  nextSection: "Show the next section",
  openCollection: "Open collection",
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

export function englishAssistAttributes(token: EnglishAssistToken) {
  return {
    title: ENGLISH_ASSIST_COPY[token],
  } as const
}
