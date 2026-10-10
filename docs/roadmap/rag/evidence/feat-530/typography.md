# Typography and surface refinement — 2026-09-28

The user accepted color alignment but found the registry lifeless and requested
another pass, particularly on typography. Preserve minimal copy, inline consumer
rows and direct creation. This supersedes the rigid 4px/red-rule treatment from
the first style pass.

Implemented: local Apercu regular/bold (copied from Forge web's existing font
assets), a larger expressive heading, softer white surfaces and rounded controls,
lightweight row actions, small status dots/pills, and a restrained red brand chip.
Removed the full-width red rule and dialog's red top edge. Hover feedback is subtle
and respects reduced-motion preferences. No explanatory copy was added.

Matched captures are in `apps/rag/output/portal-type-pass/{before,after}` with
four fixed directory fixtures, local-owner identity, Chrome for Testing
153.0.8010.12 and 1280×900 / 390×844 viewports. Creation and signed-out states are
included. Visual review found no page-level mobile overflow; longer status pills
were corrected to stay on one line. No secrets were captured. This is the
implementing agent's design assessment, pending the user's taste judgment.

The lifecycle browser journey and seven portal HTTP tests pass, as do typecheck
and lint. Font delivery uses explicit local routes with `font/woff2`, same-origin
CSP, and `font-display: swap`; the regular font is preloaded. No runtime cross-app
imports or third-party font requests. The fonts add 93,052 bytes and two requests;
total initial decoded payload is approximately 117 KB, within the revised 140 KB
browser budget. The first matched run measured 14.7 ms local load versus 10.2 ms
before typography changes; single local observations are not production timing
proof. The payload increase is an intentional cost of loading the actual typeface.

Keep this focused pass for review. Next review prompt: does the typography and
lighter treatment give the registry enough character while keeping it easy to scan?
