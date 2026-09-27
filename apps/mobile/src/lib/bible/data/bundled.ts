// Loads the BSB books and the catalog snapshot that ship inside the app
// (feat-553 KTD1, R27). Metro finds an asset only through a literal require,
// so each book has its own line; bibleAssets.guard.test.js pins all 66.
import { Asset } from "expo-asset"
import { File } from "expo-file-system"

import type { UsfmBookId } from "../text/books"
import { parseBookText } from "../text/normalize"
import type { BookText } from "../text/types"
import { BSB_TRANSLATION_ID } from "../versification/classify"
import { parseCatalog, type Catalog } from "./catalog"

/* eslint-disable @typescript-eslint/no-require-imports */
/** The asset module of each BSB book, in canon order. */
export const BUNDLED_BSB_BOOKS: Readonly<Record<UsfmBookId, number>> = {
  GEN: require("../../../../assets/bible/bsb/GEN.bible"),
  EXO: require("../../../../assets/bible/bsb/EXO.bible"),
  LEV: require("../../../../assets/bible/bsb/LEV.bible"),
  NUM: require("../../../../assets/bible/bsb/NUM.bible"),
  DEU: require("../../../../assets/bible/bsb/DEU.bible"),
  JOS: require("../../../../assets/bible/bsb/JOS.bible"),
  JDG: require("../../../../assets/bible/bsb/JDG.bible"),
  RUT: require("../../../../assets/bible/bsb/RUT.bible"),
  "1SA": require("../../../../assets/bible/bsb/1SA.bible"),
  "2SA": require("../../../../assets/bible/bsb/2SA.bible"),
  "1KI": require("../../../../assets/bible/bsb/1KI.bible"),
  "2KI": require("../../../../assets/bible/bsb/2KI.bible"),
  "1CH": require("../../../../assets/bible/bsb/1CH.bible"),
  "2CH": require("../../../../assets/bible/bsb/2CH.bible"),
  EZR: require("../../../../assets/bible/bsb/EZR.bible"),
  NEH: require("../../../../assets/bible/bsb/NEH.bible"),
  EST: require("../../../../assets/bible/bsb/EST.bible"),
  JOB: require("../../../../assets/bible/bsb/JOB.bible"),
  PSA: require("../../../../assets/bible/bsb/PSA.bible"),
  PRO: require("../../../../assets/bible/bsb/PRO.bible"),
  ECC: require("../../../../assets/bible/bsb/ECC.bible"),
  SNG: require("../../../../assets/bible/bsb/SNG.bible"),
  ISA: require("../../../../assets/bible/bsb/ISA.bible"),
  JER: require("../../../../assets/bible/bsb/JER.bible"),
  LAM: require("../../../../assets/bible/bsb/LAM.bible"),
  EZK: require("../../../../assets/bible/bsb/EZK.bible"),
  DAN: require("../../../../assets/bible/bsb/DAN.bible"),
  HOS: require("../../../../assets/bible/bsb/HOS.bible"),
  JOL: require("../../../../assets/bible/bsb/JOL.bible"),
  AMO: require("../../../../assets/bible/bsb/AMO.bible"),
  OBA: require("../../../../assets/bible/bsb/OBA.bible"),
  JON: require("../../../../assets/bible/bsb/JON.bible"),
  MIC: require("../../../../assets/bible/bsb/MIC.bible"),
  NAM: require("../../../../assets/bible/bsb/NAM.bible"),
  HAB: require("../../../../assets/bible/bsb/HAB.bible"),
  ZEP: require("../../../../assets/bible/bsb/ZEP.bible"),
  HAG: require("../../../../assets/bible/bsb/HAG.bible"),
  ZEC: require("../../../../assets/bible/bsb/ZEC.bible"),
  MAL: require("../../../../assets/bible/bsb/MAL.bible"),
  MAT: require("../../../../assets/bible/bsb/MAT.bible"),
  MRK: require("../../../../assets/bible/bsb/MRK.bible"),
  LUK: require("../../../../assets/bible/bsb/LUK.bible"),
  JHN: require("../../../../assets/bible/bsb/JHN.bible"),
  ACT: require("../../../../assets/bible/bsb/ACT.bible"),
  ROM: require("../../../../assets/bible/bsb/ROM.bible"),
  "1CO": require("../../../../assets/bible/bsb/1CO.bible"),
  "2CO": require("../../../../assets/bible/bsb/2CO.bible"),
  GAL: require("../../../../assets/bible/bsb/GAL.bible"),
  EPH: require("../../../../assets/bible/bsb/EPH.bible"),
  PHP: require("../../../../assets/bible/bsb/PHP.bible"),
  COL: require("../../../../assets/bible/bsb/COL.bible"),
  "1TH": require("../../../../assets/bible/bsb/1TH.bible"),
  "2TH": require("../../../../assets/bible/bsb/2TH.bible"),
  "1TI": require("../../../../assets/bible/bsb/1TI.bible"),
  "2TI": require("../../../../assets/bible/bsb/2TI.bible"),
  TIT: require("../../../../assets/bible/bsb/TIT.bible"),
  PHM: require("../../../../assets/bible/bsb/PHM.bible"),
  HEB: require("../../../../assets/bible/bsb/HEB.bible"),
  JAS: require("../../../../assets/bible/bsb/JAS.bible"),
  "1PE": require("../../../../assets/bible/bsb/1PE.bible"),
  "2PE": require("../../../../assets/bible/bsb/2PE.bible"),
  "1JN": require("../../../../assets/bible/bsb/1JN.bible"),
  "2JN": require("../../../../assets/bible/bsb/2JN.bible"),
  "3JN": require("../../../../assets/bible/bsb/3JN.bible"),
  JUD: require("../../../../assets/bible/bsb/JUD.bible"),
  REV: require("../../../../assets/bible/bsb/REV.bible"),
}

const CATALOG_ASSET: number = require("../../../../assets/bible/catalog.bible")
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Why a bundled file did not load. For the reader, each one means the text is
 * not on the device, so it shows R31's message with a retry.
 */
export type BundledFailureReason =
  | "asset-unavailable"
  | "read-failed"
  | "invalid-data"

export type BundledResult<T> =
  | { status: "ok"; value: T }
  | { status: "failed"; reason: BundledFailureReason }

function failed(reason: BundledFailureReason): BundledResult<never> {
  return { status: "failed", reason }
}

async function readAssetJson(
  moduleId: number,
): Promise<BundledResult<unknown>> {
  let localUri: string | null
  try {
    // After an update that changed the file, this call downloads the new one.
    localUri = (await Asset.fromModule(moduleId).downloadAsync()).localUri
  } catch {
    return failed("asset-unavailable")
  }
  if (!localUri) return failed("asset-unavailable")

  let text: string
  try {
    text = await new File(localUri).text()
  } catch {
    return failed("read-failed")
  }
  try {
    return { status: "ok", value: JSON.parse(text) as unknown }
  } catch {
    return failed("invalid-data")
  }
}

/** One BSB book from the app bundle. It never throws. */
export async function loadBundledBook(
  bookId: UsfmBookId,
): Promise<BundledResult<BookText>> {
  const raw = await readAssetJson(BUNDLED_BSB_BOOKS[bookId])
  if (raw.status !== "ok") return raw
  const book = parseBookText(raw.value)
  if (
    book.status !== "ok" ||
    book.value.bookId !== bookId ||
    book.value.translationId !== BSB_TRANSLATION_ID
  ) {
    return failed("invalid-data")
  }
  return { status: "ok", value: book.value }
}

/** The catalog snapshot from the app bundle. It never throws. */
export async function loadBundledCatalog(): Promise<BundledResult<Catalog>> {
  const raw = await readAssetJson(CATALOG_ASSET)
  if (raw.status !== "ok") return raw
  const catalog = parseCatalog(raw.value)
  return catalog === null
    ? failed("invalid-data")
    : { status: "ok", value: catalog }
}
