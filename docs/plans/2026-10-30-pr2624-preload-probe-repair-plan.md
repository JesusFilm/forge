# PR #2624 preload probe corrections

Related ticket: `docs/roadmap/topic-experiences/feat-443-watch-mobile-lcp.md`
(FGE-117, still in progress).

## Scope and evidence

Repair the three source-confirmed findings on
`7a4c155f92e1eeb4a13099df01e49625c99f6b36` in
`apps/web/src/lib/watch-url-probe.ts` and its tests. The independent review and
parent diagnostics reproduce missed Link-header preloads (R1-2624-1/P2),
ignored responsive sizes/descriptors (R1-2624-2/P2), and rejected equivalent
resource URLs (R1-2624-3/P3).

## Implementation

- Tokenize Link values and parameters with quote, escape and URI-bracket
  awareness; trim parameter whitespace, retain the first parameter occurrence,
  and interpret relation names as a set. Keep unrelated font/script hints out
  of the image count.
- Preserve source-size attributes and responsive URL/descriptor pairs. Match
  width-based source sizes and candidate identities, accepting irrelevant
  ordering/numeric/whitespace differences. A static member of a responsive
  candidate set does not certify the full responsive preload contract.
  Include each identity's implicit default `1x` resource when its density set
  has no explicit `1x`; width sets ignore this default. The R2 review caught
  that equal explicit `2x` candidates can otherwise conceal different defaults.
- Retain the actual final document URL separately from the cross-host
  comparable pathname. Resolve resource identities against that URL without
  substituting SEO canonical origins or dropping query/base-path distinctions.

## Verification and review

Run discriminating parse-to-classify cases red before the repair and green
afterward, including a nonresponsive poster to isolate quoted-comma parsing.
Run the four focused suites with two workers, touched-source lint/type checks,
formatting and whitespace. Obtain a fresh immutable-tree independent review.
Preserve RUM, promo and player runtime bytes; no browser/performance claim
follows from this offline-tool correction. Existing current-target and field
acceptance requirements remain open. No production actions or paid calls.

## Durable learning

Compare the inputs that drive browser resource selection, rather than only URL
membership. Header list separators inside quoted strings are data. A response's
final URL supplies resource resolution context; its SEO canonical does not.
