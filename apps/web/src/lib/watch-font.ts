import localFont from "next/font/local"

// Montserrat, split into three unicode-range subset families so a page
// downloads only the scripts it renders. Latin pages fetch the ~59 KB latin
// file instead of the ~206 KB full face; Cyrillic text adds ~47 KB, and any
// other code point the font covers (Latin Extended, Vietnamese, IPA, symbols)
// adds ~135 KB. Only the latin file is preloaded. Regenerate the files and
// the ranges below with `python3 scripts/subset-watch-font.py`; next/font
// only accepts literal options, so the ranges cannot be imported.
//
// Each subset is its own family; `--font-montserrat` in globals.css chains
// them, so the browser takes each glyph from the family whose range covers
// it. A shared declared `font-family` does not work: Turbopack's next/font
// names the exported family after the JS binding, not the declaration. The
// latin instance owns the metric-adjusted fallback and the native stack.
//
// Italic was dropped earlier: the one `italic` class (AdventCountdown) is
// synthesized from the upright face. The faces ship as woff2 because its
// brotli beats the gzip Next.js applies to ttf transfers.
const montserratLatin = localFont({
  src: "../fonts/montserrat-latin.woff2",
  weight: "100 900",
  style: "normal",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000, U+000D, U+0020-007E, U+00A0-00AC, U+00AE-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2007-200B, U+2010, U+2012-2015, U+2018-201A, U+201C-201E, U+2020-2022, U+2026, U+2030, U+2032-2033, U+2039-203A, U+2044, U+2052, U+20AC, U+2122, U+2190-2195, U+2212, U+2215, U+2248",
    },
  ],
  variable: "--font-montserrat-latin",
  fallback: [
    "Avenir Next",
    "Avenir",
    "Helvetica Neue",
    "Helvetica",
    "Segoe UI",
    "Roboto",
    "Noto Sans",
    "Liberation Sans",
    "Arial",
    "sans-serif",
  ],
  display: "swap",
})

const montserratCyrillic = localFont({
  src: "../fonts/montserrat-cyrillic.woff2",
  weight: "100 900",
  style: "normal",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0301, U+0400-045F, U+0462-0463, U+046A-046B, U+0472-0475, U+048A-04FF, U+0510-0513, U+051A-051D, U+0524-0529, U+052E-052F, U+20B4, U+2116",
    },
  ],
  variable: "--font-montserrat-cyrillic",
  preload: false,
  adjustFontFallback: false,
  display: "swap",
})

const montserratRest = localFont({
  src: "../fonts/montserrat-rest.woff2",
  weight: "100 900",
  style: "normal",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-0130, U+0132-0151, U+0154-0183, U+0186-018C, U+018E-0194, U+0196-01A1, U+01A4-01A6, U+01A9, U+01AC-01B9, U+01C0-01F5, U+01F8-0220, U+0222-0223, U+0226-0233, U+0237, U+023A-023E, U+0241-0251, U+0253-0254, U+0256-0259, U+025B-025C, U+025F-0260, U+0263-0266, U+0268-026C, U+026F, U+0271-0272, U+0274-0275, U+027D-027E, U+0280, U+0283, U+0287-028C, U+028E, U+0292, U+0294-0295, U+0298, U+029D, U+02B0, U+02B7-02BA, U+02BD-02C1, U+02C7-02CC, U+02D7-02D9, U+02DB, U+02DD, U+02EC, U+02EE, U+02FB-02FC, U+0300-0304, U+0306-030D, U+030F-0313, U+0315, U+031B, U+0320, U+0323-0329, U+032D-0332, U+0334-0338, U+034F, U+0358, U+035C-035D, U+035F, U+0361-0362, U+0394, U+039B, U+03A7, U+03A9, U+03BB-03BC, U+03C0, U+03C7, U+1D3A, U+1D43, U+1D49, U+1D4B, U+1D52-1D53, U+1D58, U+1D5B, U+1D7B, U+1D7D-1D7E, U+1D91, U+1DA4, U+1DB6, U+1DBB, U+1DBF, U+1DC4-1DCA, U+1E00-1E9B, U+1E9E, U+1EA0-1EF9, U+2070-2071, U+2074-2079, U+207F-2089, U+20A1, U+20A3-20A4, U+20A6-20A7, U+20A9, U+20AB, U+20AD-20AE, U+20B1-20B2, U+20B5, U+20B8-20BA, U+20BC-20BD, U+20BF, U+2113, U+2126, U+212A-212B, U+212E, U+2144, U+2153-2154, U+215B-215E, U+2183-2184, U+2196-2199, U+2202, U+2205-2206, U+220F, U+2211, U+2219-221A, U+221E, U+222B, U+2260, U+2264-2265, U+24B6, U+24D0, U+25A0-25A1, U+25B2-25B3, U+25B6-25B7, U+25BC-25BD, U+25C0-25C1, U+25C6-25C7, U+25CA, U+25CC, U+27E8-27E9, U+2C60-2C66, U+2C6D-2C6F, U+2C72-2C73, U+A717-A71A, U+A726-A727, U+A740-A741, U+A789-A78D, U+A792-A793, U+A7A8-A7AB, U+A7AD-A7AE, U+A7B1-A7B9, U+A7C7-A7C8, U+A7CB-A7CD, U+A7DA-A7DC, U+AB53, U+FB01-FB02",
    },
  ],
  variable: "--font-montserrat-rest",
  preload: false,
  adjustFontFallback: false,
  display: "swap",
})

export const montserrat = {
  variable: `${montserratLatin.variable} ${montserratCyrillic.variable} ${montserratRest.variable}`,
}
