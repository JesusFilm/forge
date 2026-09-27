// The catalog keys its languages by ISO 639-3 individual codes, with no
// macrolanguage codes such as zho (feat-553 KTD8). The phone's ISO 639-1 code
// and admin's macrolanguage codes both go through the tables below.
import { getDeviceLanguageCode } from "../../resolveDefaultLanguage"
import { LANGUAGE_DEFAULT_TRANSLATIONS } from "../data/languageDefaults.generated"

/** Every ISO 639-1 code to its ISO 639-3 code; a macrolanguage stays macro. */
export const ISO_639_1_TO_639_3: Readonly<Record<string, string>> = {
  aa: "aar",
  ab: "abk",
  ae: "ave",
  af: "afr",
  ak: "aka",
  am: "amh",
  an: "arg",
  ar: "ara",
  as: "asm",
  av: "ava",
  ay: "aym",
  az: "aze",
  ba: "bak",
  be: "bel",
  bg: "bul",
  bh: "bih",
  bi: "bis",
  bm: "bam",
  bn: "ben",
  bo: "bod",
  br: "bre",
  bs: "bos",
  ca: "cat",
  ce: "che",
  ch: "cha",
  co: "cos",
  cr: "cre",
  cs: "ces",
  cu: "chu",
  cv: "chv",
  cy: "cym",
  da: "dan",
  de: "deu",
  dv: "div",
  dz: "dzo",
  ee: "ewe",
  el: "ell",
  en: "eng",
  eo: "epo",
  es: "spa",
  et: "est",
  eu: "eus",
  fa: "fas",
  ff: "ful",
  fi: "fin",
  fj: "fij",
  fo: "fao",
  fr: "fra",
  fy: "fry",
  ga: "gle",
  gd: "gla",
  gl: "glg",
  gn: "grn",
  gu: "guj",
  gv: "glv",
  ha: "hau",
  he: "heb",
  hi: "hin",
  ho: "hmo",
  hr: "hrv",
  ht: "hat",
  hu: "hun",
  hy: "hye",
  hz: "her",
  ia: "ina",
  id: "ind",
  ie: "ile",
  ig: "ibo",
  ii: "iii",
  ik: "ipk",
  io: "ido",
  is: "isl",
  it: "ita",
  iu: "iku",
  ja: "jpn",
  jv: "jav",
  ka: "kat",
  kg: "kon",
  ki: "kik",
  kj: "kua",
  kk: "kaz",
  kl: "kal",
  km: "khm",
  kn: "kan",
  ko: "kor",
  kr: "kau",
  ks: "kas",
  ku: "kur",
  kv: "kom",
  kw: "cor",
  ky: "kir",
  la: "lat",
  lb: "ltz",
  lg: "lug",
  li: "lim",
  ln: "lin",
  lo: "lao",
  lt: "lit",
  lu: "lub",
  lv: "lav",
  mg: "mlg",
  mh: "mah",
  mi: "mri",
  mk: "mkd",
  ml: "mal",
  mn: "mon",
  mr: "mar",
  ms: "msa",
  mt: "mlt",
  my: "mya",
  na: "nau",
  nb: "nob",
  nd: "nde",
  ne: "nep",
  ng: "ndo",
  nl: "nld",
  nn: "nno",
  no: "nor",
  nr: "nbl",
  nv: "nav",
  ny: "nya",
  oc: "oci",
  oj: "oji",
  om: "orm",
  or: "ori",
  os: "oss",
  pa: "pan",
  pi: "pli",
  pl: "pol",
  ps: "pus",
  pt: "por",
  qu: "que",
  rm: "roh",
  rn: "run",
  ro: "ron",
  ru: "rus",
  rw: "kin",
  sa: "san",
  sc: "srd",
  sd: "snd",
  se: "sme",
  sg: "sag",
  si: "sin",
  sk: "slk",
  sl: "slv",
  sm: "smo",
  sn: "sna",
  so: "som",
  sq: "sqi",
  sr: "srp",
  ss: "ssw",
  st: "sot",
  su: "sun",
  sv: "swe",
  sw: "swa",
  ta: "tam",
  te: "tel",
  tg: "tgk",
  th: "tha",
  ti: "tir",
  tk: "tuk",
  tl: "tgl",
  tn: "tsn",
  to: "ton",
  tr: "tur",
  ts: "tso",
  tt: "tat",
  tw: "twi",
  ty: "tah",
  ug: "uig",
  uk: "ukr",
  ur: "urd",
  uz: "uzb",
  ve: "ven",
  vi: "vie",
  vo: "vol",
  wa: "wln",
  wo: "wol",
  xh: "xho",
  yi: "yid",
  yo: "yor",
  za: "zha",
  zh: "zho",
  zu: "zul",
}

/**
 * Codes a phone can report that are not in the table above: the old Java
 * codes that some Android versions still give, and Filipino, whose catalog
 * Bible is under Tagalog.
 */
export const LANGUAGE_CODE_ALIASES: Readonly<Record<string, string>> = {
  iw: "heb",
  in: "ind",
  ji: "yid",
  mo: "ron",
  fil: "tgl",
}

/**
 * Each macrolanguage to its individual languages, most likely reader first.
 * The first one with a catalog Bible wins. A member is left out when a reader
 * of the macrolanguage could not read it (another script or language).
 */
export const MACROLANGUAGE_MEMBERS: Readonly<
  Record<string, readonly string[]>
> = {
  aka: ["twi", "fat"],
  ara: ["arb"],
  aym: ["ayr", "ayc"],
  // The catalog's azb Bible is the Latin-script Azerbaijani Bible (BSA).
  aze: ["azj", "azb"],
  cre: ["crk", "cwd", "csw", "crl", "crj", "crm"],
  din: ["dik", "dib", "dip", "diw", "dks"],
  est: ["ekk"],
  fas: ["pes", "prs"],
  // Pulaar and Pular only; the eastern Fulfulde are further apart.
  ful: ["fuc", "fuf"],
  grn: ["gug"],
  iku: ["ike", "ikt"],
  ipk: ["esk", "esi"],
  kau: ["knc"],
  kom: ["kpv", "koi"],
  kon: ["kng", "ldi", "kwy"],
  // Not ckb: that Bible is Sorani in Arabic script, and ku is Kurmanji.
  kur: ["kmr"],
  lav: ["lvs"],
  mlg: ["plt", "tdx"],
  mon: ["khk"],
  msa: ["zsm", "zlm"],
  nep: ["npi"],
  nor: ["nob", "nno"],
  oji: ["ojb", "ojc", "ojg", "ojs", "ojw", "ciw", "otw"],
  ori: ["ory"],
  orm: ["gaz", "hae", "orc", "gax"],
  pus: ["pbt", "pbu", "pst"],
  // Southern Quechua only; the central varieties are further apart.
  que: ["quz", "quy", "quh"],
  sqi: ["als", "aln"],
  srd: ["src", "sro"],
  swa: ["swh", "swc"],
  syr: ["aii", "cld"],
  uzb: ["uzn"],
  yid: ["ydd"],
  zha: ["zyb"],
  zho: ["cmn"],
}

/**
 * The catalog language for a code from the phone (ISO 639-1, or a 3-letter
 * subtag) or from admin (ISO 639-3, maybe a macrolanguage). Null when the
 * catalog has no Bible for it.
 */
export function catalogLanguageCode(
  code: string | null | undefined,
  languageDefaults: Readonly<
    Record<string, string>
  > = LANGUAGE_DEFAULT_TRANSLATIONS,
): string | null {
  if (typeof code !== "string") return null
  const lower = code.trim().toLowerCase()
  if (!/^[a-z]{2,3}$/.test(lower)) return null
  const alias = LANGUAGE_CODE_ALIASES[lower]
  const iso3 = alias ?? (lower.length === 2 ? ISO_639_1_TO_639_3[lower] : lower)
  if (iso3 === undefined) return null
  for (const candidate of [iso3, ...(MACROLANGUAGE_MEMBERS[iso3] ?? [])]) {
    if (languageDefaults[candidate] !== undefined) return candidate
  }
  return null
}

/** The phone's language subtag ("zh" for "zh-Hant-TW"), or null. */
export function readPhoneLanguageCode(): string | null {
  const language = getDeviceLanguageCode()
  return language !== null && /^[a-z]{2,3}$/.test(language) ? language : null
}
