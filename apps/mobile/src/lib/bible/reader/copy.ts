// The reader's own words (feat-551). Scripture text and translation credits
// come from the data; every other string the reader shows lives here, so the
// documentation and a later translation of the app find them in one place.

export const READER_COPY = {
  /** KD10, KD16: this line replaces Still's tagline in the footer. */
  stillCredit: "Powered by StillBibleApp.com",
  /** R21, AE9: shown in place of a verse that the translation lacks. */
  missingVerse: (verse: number) => `This translation has no verse ${verse}.`,
  loading: "Loading the chapter",
  back: "Go back",
  settings: "Reader settings",
  choosePassage: (passage: string) => `${passage}. Choose a passage`,
  choosePassageWaiting: "Choose a passage",
  translation: (name: string) => `Translation: ${name}. Change translation`,
  /** R25: the book is not in the viewer's translation. */
  shownIn: (shortName: string) => `Shown in ${shortName}`,
  bookFallback: (viewerName: string | null, shownName: string) =>
    viewerName
      ? `${viewerName} does not have this book. Shown in ${shownName}. Change translation`
      : `This book is shown in ${shownName}. Change translation`,
  /** R41: BSB stands in for a default translation that is not on the device. */
  offlineStandIn: "Offline",
  offlineStandInLabel: (shownName: string) =>
    `You are offline. Shown in ${shownName}. Change translation`,
  counter: (first: number, last: number, total: number) =>
    first === last
      ? `Verse ${first} of ${total}`
      : `Verses ${first} to ${last} of ${total}`,
  verse: (first: number, last: number, text: string) =>
    first === last
      ? `Verse ${first}. ${text}`
      : `Verses ${first} to ${last}. ${text}`,
  download: {
    start: (name: string) => `Download ${name}`,
    onDevice: (name: string) => `${name} is on this device`,
    running: (name: string, percent: number) =>
      `Downloading ${name}, ${percent} percent`,
    failed: (name: string) => `The download of ${name} stopped. Try again`,
    waiting: "Download translation",
  },
  failure: {
    offlineTitle: "This chapter is not on this device",
    offlineBody:
      "Connect to the internet and try again, or read in a translation that is on this device.",
    failedTitle: "This chapter did not load",
    failedBody: "Try again, or read in a translation that is on this device.",
    catalogTitle: "The Bible did not load",
    catalogBody: "Try again. If it does not load, restart the app.",
    retry: "Try again",
    switchTo: (shortName: string) => `Read in ${shortName}`,
  },
} as const
