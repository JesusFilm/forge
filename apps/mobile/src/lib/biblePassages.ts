// Fail-closed projection for admin-resolved Bible passages (KTD5).
//
// Admin passes provider columns through raw, so a present-but-blank field is a
// real shape. Every required value is gated on truthiness, never on `!= null`.

export type RawBiblePassage = {
  content?: string | null
  copyright?: string | null
  humanReference?: string | null
  provider?: string | null
  reference?: string | null
  versionAbbreviation?: string | null
  versionId?: number | null
  versionTitle?: string | null
}

/** The eight values R6 requires before a card may render verse text. */
export type RequiredPassageField =
  | "content"
  | "copyright"
  | "humanReference"
  | "provider"
  | "reference"
  | "versionAbbreviation"
  | "versionId"
  | "versionTitle"

export type RenderableBiblePassage = {
  reference: string
  content: string
  copyright: string
  versionTitle: string
  versionAbbreviation: string
  /** Always present: R6 requires exactly the fields the link is built from. */
  passageUrl: string
}

export type BiblePassageProjection =
  | { status: "renderable"; passage: RenderableBiblePassage }
  | { status: "absent" }
  | { status: "rejected"; missingField: RequiredPassageField }

function text(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

// SYNC with `getBibleComUrl` in apps/web/src/components/watch/BibleQuotesSection.tsx.
// Same output for the same passage; a divergence sends the two apps to
// different bible.com pages for one citation. One deliberate difference: the
// gate above trims every string, so a reference carrying stray whitespace is
// encoded trimmed here and raw on web. Admin emits none today.
function bibleComUrl(
  versionId: number,
  reference: string,
  abbreviation: string,
): string {
  return `https://www.bible.com/bible/${versionId}/${encodeURIComponent(
    reference,
  )}.${encodeURIComponent(abbreviation)}`
}

/**
 * Project one raw passage into a renderable card payload, or say why it cannot
 * be rendered. `rejected` is deliberately distinct from `absent`: a passage that
 * arrived and failed the gate is the signal that an upstream change started
 * suppressing verses, and it must not look like admin's designed no-passage
 * outcome.
 */
export function projectBiblePassage(
  raw: RawBiblePassage | null | undefined,
): BiblePassageProjection {
  if (raw == null) return { status: "absent" }

  const content = text(raw.content)
  if (content == null) return { status: "rejected", missingField: "content" }

  const copyright = text(raw.copyright)
  if (copyright == null)
    return { status: "rejected", missingField: "copyright" }

  const humanReference = text(raw.humanReference)
  if (humanReference == null) {
    return { status: "rejected", missingField: "humanReference" }
  }

  const provider = text(raw.provider)
  if (provider == null) return { status: "rejected", missingField: "provider" }

  const reference = text(raw.reference)
  if (reference == null)
    return { status: "rejected", missingField: "reference" }

  const versionAbbreviation = text(raw.versionAbbreviation)
  if (versionAbbreviation == null) {
    return { status: "rejected", missingField: "versionAbbreviation" }
  }

  // A positive integer, not merely a finite number: 0 and fractions build a
  // syntactically valid bible.com URL that resolves to nothing.
  const versionId = raw.versionId
  if (
    typeof versionId !== "number" ||
    !Number.isInteger(versionId) ||
    versionId <= 0
  ) {
    return { status: "rejected", missingField: "versionId" }
  }

  const versionTitle = text(raw.versionTitle)
  if (versionTitle == null) {
    return { status: "rejected", missingField: "versionTitle" }
  }

  return {
    status: "renderable",
    passage: {
      reference: humanReference,
      content,
      copyright,
      versionTitle,
      versionAbbreviation,
      passageUrl: bibleComUrl(versionId, reference, versionAbbreviation),
    },
  }
}
