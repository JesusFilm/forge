# Residual Review Findings

Source: `ce-code-review` run `20260710-2303-ggGhJY` against
`origin/main` with plan
`docs/plans/2026-07-10-001-feat-watch-home-share-action-plan.md`.

- **P2** `apps/web/src/components/home/WatchHomeTvCarousel.tsx:968` —
  Carousel remains locked after Share closes.
  The Share dialog stays mounted for its 150 ms exit animation, and the
  current lock follows that retained slide instead of the dialog's `open`
  state. Decide whether carousel controls should resume immediately on the
  close event or after the exit animation; if immediate resumption is desired,
  derive the lock from `shareOpen` while retaining `shareSlide` only for the
  closing dialog. Review confidence: 75. This was not applied because the
  intended close-animation interaction needs a product decision.
