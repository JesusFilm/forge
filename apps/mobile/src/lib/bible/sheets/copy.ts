// The Bible reader's license and credit notices (feat-553 KD10, U10). The
// reader's other words are in the catalog. These stay in English, outside the
// translated catalogs, until a human reviews a translation (KTD17).

export const BIBLE_NOTICES = {
  /** KD10, KD16: the footer credit, in the wording Still's creator approved. */
  stillCredit: "Powered by StillBibleApp.com",
  bsbCredit:
    "The Berean Standard Bible (BSB) is in the public domain. It is part of the app.",
  catalogCredit:
    "Other translations come from the Free Use Bible API (bible.helloao.org). Their licenses come from eBible.org, and each translation keeps its own license.",
  versificationCredit:
    "Verse number mappings: Copenhagen Alliance, CC BY-SA 4.0.",
  /** The shown translation's own name and credit, from the catalog data. */
  currentCredit: (name: string, credit: string) => `${name}: ${credit}`,
} as const

/** The notices' language, so a screen reader reads them as English. */
export const BIBLE_NOTICE_LANGUAGE = "en"
