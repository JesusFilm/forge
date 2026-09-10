---
module: Shorts
problem_type: integration
tags: [shorts, preview, remotion, browser]
---

# Inline browser preview

`video-studio/preview.tsx` is lazy-loaded by the editor and renders the shared
Remotion composition directly in the page. Custom TSX executes with the same
browser access as the editor, as explicitly requested by the owner. There is no
iframe, sandbox, message bridge, heartbeat, or separate runtime download.
React/player errors display a retry action; this does not contain infinite loops
or prevent custom code from accessing the page. Final rendering remains isolated
on the VM; browser execution does not run authored code on the application server.

`shorts-browser-preview.ts` checks canonical source eligibility and returns HLS
URLs and digest-read retained assets with byte limits. Preview creates local blob
URLs and revokes them on replacement/unmount. Text-only edits need no API call.
Source preparation aborts on project/source changes; current timeline edits are
passed directly to the player. Frame, seek and playback events use Player refs.

Explicit `render-prepare` retains codec verification and materialization before
render admission. Keep the legacy-named `STUDIO_PREVIEW_API_KEY` for render proofs.
Manager's standalone build copies ordinary public assets; no preview JS file is
required in `public` anymore.

## Verification

- Manager production build, affected types/lint, 14 focused tests and 69
  composition tests passed. Frozen offline dependency installation passed.
- Actual browser fixture: zero iframes, Mux video/audio playback, seek to 30s,
  immediate text edits and inline custom TSX rendering passed.
- Six alternating text-only component navigations: iframe median ready 434ms,
  inline 213ms. Total preview JS gzip fell from 547,364 to 420,925 bytes. Fixture
  DOMContentLoaded rose from 120ms to 197ms because its entry directly imports the
  player; the real editor still uses its existing dynamic import. These are
  component-fixture measurements, not a production page performance guarantee.

No raw captures, media, or generated bundles are committed.
