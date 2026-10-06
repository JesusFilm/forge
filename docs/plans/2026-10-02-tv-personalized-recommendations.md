# TV personalized recommendations

## Approved scope

Replace Because you watched with six Recommended for you cards. Order Home as
Continue Watching, My List, Recommended for you, then curated rails. Retain the
legacy path when `EXPO_PUBLIC_TV_RECOMMENDATIONS_ENABLED=false`.

Use the existing shared Admin GraphQL operations with a narrowly allowlisted TV
fleet bearer. Anonymous viewer and session tokens belong in SecureStore, separate
from sign-in and search identity. Rotate the session after 24 hours of inactivity,
never during playback. Bootstrap expired handles without losing personalization
choice. Use UI locale `en` and saved audio language, defaulting to English.

Defer delivery until the row approaches the viewport; never block Home. Refresh
on Home return, audio preference changes and personalization changes. Keep rows
stable while navigating. Explicit unavailable and Retry states must not replace
missing dubs. Retry cooldown/in_flight once after five seconds.

Keep selection attribution and capabilities only in memory. Record render and
impression after 50% continuous visibility for one second, independently of focus.
Recommendations use selection then episode claim; other actual video playback
uses playback context then claim. Previews do not count.

All four player variants expose source-generation-bound state observations.
Count foreground playing intervals, excluding seeks, pauses, buffering and
background. Send progress every ten seconds and flush on transitions and exit.
Retry immutable event IDs and payloads according to the existing evidence contract.

Settings offers Personalized recommendations and Reset recommendations using
withdraw/grant/reset. Do not erase My List or Continue Watching. Fence stale
delivery, attribution and playback after privacy changes.

## Release gate

Identity/session/privacy, transport/auth, audio coverage, timeout/retry, remote
navigation and all playback transitions require automated and emulator/simulator
checks. Verify backend playback acceptance rather than inferring it from position.
Run TV tests, typecheck, lint and both native builds. Build tvOS and Android from
the same commit, upload using appletvos/TestFlight and Play Internal Testing, and
verify processing and tester access. Keep the roadmap in progress until complete.

## Baseline

`cdfcb4eab` contains the consolidated TV beta (`apps/tv` matches build-13 baseline
apart from documentation). Work is isolated on
`codex/tv-personalized-recommendations`; existing feedback worktrees are untouched.

## Implementation checkpoint

See `docs/tv-personalized-recommendations-validation-2026-10-02.md` for code and
live API evidence, disk-space pause, and the remaining device and release gates.
