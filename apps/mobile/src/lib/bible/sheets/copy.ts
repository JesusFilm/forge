// The words of the reader's three sheets and its download prompt (feat-551
// U10). Scripture text and credits come from the data; the reader's own
// strings live in reader/copy.ts.

export const READER_SHEET_COPY = {
  close: "Close",
  passage: {
    chooseBook: "Choose a book",
    oldTestament: "Old Testament",
    newTestament: "New Testament",
    backToBooks: "Books",
    backToChapters: "Chapters",
    chapterTitle: (bookName: string, chapter: number) =>
      `${bookName} ${chapter}`,
    chapter: (chapter: number) => `Chapter ${chapter}`,
    verse: (verse: number) => `Verse ${verse}`,
    /** R25: the reader shows this book in another translation. */
    notInTranslation: (shortName: string) => `Not in ${shortName}`,
    goBackTo: (label: string) => `Back to ${label}`,
  },
  translation: {
    title: "Translation",
    searchPlaceholder: "Search language or translation",
    searchLabel: "Search translations",
    noMatch: "No translation matches your search.",
    onDeviceOnly: "Only translations on this device",
    offlineNote:
      "You are offline. Translations on this device read with no connection.",
    complete: "Complete Bible",
    partial: "Partial Bible",
    onDevice: "On this device",
    downloading: (percent: number) => `Downloading ${percent}%`,
    downloadStopped: "Download stopped",
    updateAvailable: "Update available",
  },
  settings: {
    title: "Reader settings",
    mode: "Mode",
    modes: { system: "System", light: "Light", dark: "Dark" },
    textSize: "Text size",
    textSizeStep: (step: number, total: number) => `Size ${step} of ${total}`,
    palette: "Palette",
    palettes: { classic: "Classic", trueDark: "True Dark" },
    typeface: "Typeface",
    typefaces: { serif: "Serif", sans: "Sans" },
    lineSpacing: "Line spacing",
    lineSpacings: { compact: "Compact", normal: "Normal", relaxed: "Relaxed" },
    verseNumbers: "Verse numbers",
    showArrows: "Show arrow buttons",
    showArrowsHint: "Buttons to go to the next or the previous verse.",
    aboutTitle: "About the text",
    bsbCredit:
      "The Berean Standard Bible (BSB) is in the public domain. It is part of the app.",
    catalogCredit:
      "Other translations come from the Free Use Bible API (bible.helloao.org). Their licenses come from eBible.org, and each translation keeps its own license.",
    versificationCredit:
      "Verse number mappings: Copenhagen Alliance, CC BY-SA 4.0.",
    currentCredit: (name: string, credit: string) => `${name}: ${credit}`,
  },
  download: {
    ok: "OK",
    cancel: "Cancel",
    start: "Download",
    keepGoing: "Keep downloading",
    stop: "Cancel download",
    remove: "Remove",
    update: "Update",
    retry: "Try again",
    bundledTitle: (name: string) => `${name} is on this device`,
    bundledBody:
      "This translation is part of the app, so it reads with no connection.",
    startTitle: (name: string) => `Download ${name}?`,
    startBody: (size: string) =>
      `The download is ${size}. Then the whole translation reads with no connection.`,
    runningTitle: (name: string) => `Downloading ${name}`,
    runningBody: (percent: number, size: string) => `${percent}% of ${size}.`,
    installingBody: "The download is complete. The app is saving the books.",
    onDeviceTitle: (name: string) => `${name} is on this device`,
    onDeviceBody: (size: string) =>
      `It uses ${size}. If you remove it, the reader loads it again one chapter at a time.`,
    updateTitle: (name: string) => `An update for ${name}`,
    updateBody: (size: string) =>
      `A new version of this translation is available. The download is ${size}.`,
    failedTitle: (name: string) => `The download of ${name} stopped`,
    failedBody: {
      network: "Make sure that the device is online, then try again.",
      "no-space": (size: string) =>
        `The device does not have enough free space. The download needs ${size}.`,
      "too-large": "This translation is too large to download.",
      "invalid-data": "The file was not correct. Try again later.",
      "write-failed": "The device could not save the translation. Try again.",
    },
    busyTitle: "Another download is running",
    busyBody:
      "The app downloads one translation at a time. Try again when it ends.",
  },
} as const
