# Review residuals: Watch media collection copy order

Source review run: `20260721-164509-5756af19`

Source artifact: `/tmp/compound-engineering/ce-code-review/20260721-164509-5756af19/`

Branch: `fix/watch-media-collection-copy-order`

## Residual Review Findings

- P2 `apps/web/src/components/sections/MediaCollection.test.tsx:517` — Optional-state matrix never asserts category labels ([GitHub issue #1647](https://github.com/JesusFilm/forge/issues/1647)).
