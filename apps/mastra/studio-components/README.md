# Devotional look: Shorts Studio components

Custom components our devotionals use in Shorts Studio
(manager.jesusfilm.org/dashboard/shorts). Studio keeps the uploaded code and
any project reuses it by reference, so nobody needs this folder to _use_ a
component. This folder keeps what each one was built from, so it can be
changed and re-uploaded from any machine.

- `registry.json`: every component in Studio, with the exact `registration`
  block to paste into a project's `document.components[]` (or a
  `register-component` operation), what it draws, its language and controls.
  Start here.
- `src/`: sources; fonts are placeholders (`__LIT400__`, `"__FONT__"`, …).
- `fonts/`: subset WOFF2 files (Literata, Inter, PT Serif; SIL Open Font
  License). `subset-fonts.py` makes the `literata400*` and
  `inter600caps-cyrillic` ones from the fonts in
  `packages/shorts-compositions` (`pip install fonttools brotli`). It keeps
  files that exist: another fontTools gives other bytes, and the uploaded
  components' digests would stop matching their sources.
- `uploaded/`: exact uploaded bytes for components whose source is not kept
  here (`Caption-orange`, `paper-strips-v1`, `dbp-mark-v1`, the Russian
  `kinetic-ru-v1` and `cta-calm-ru-v1`). Not reformatted, not linted.
- `dist/` (git-ignored): what `build.mjs` builds.

Build (embeds the fonts and the lockup, writes `dist/`, compares each build
with the version uploaded to Studio):

```bash
node apps/mastra/studio-components/build.mjs
```

The recipe for a whole vertical devotional with these components:
`docs/studio-devotional-recipe.md`. `make-devotional-project.py` turns an
approved script into the project's create document and apply operations
(input format in its header; `examples/widow-en.json` is the Persistent
Widow):

```bash
python3 -I apps/mastra/studio-components/make-devotional-project.py apps/mastra/studio-components/examples/widow-en.json /tmp/widow-studio
```

## Studio rules for component code

- One default-exported React function; imports only `react` and `remotion`
  (AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring,
  Sequence, Easing). No files, no Img/Video, no delayRender.
- At most 32768 bytes, fonts included. Latin and Cyrillic builds of one source
  are separate components for that reason (`reveal-serif-en-v2` /
  `reveal-serif-ru-v2`).
- Every item must set every declared control (colours cannot be `""`),
  and so must every `set-properties` operation: a partial set (only `top`)
  is refused as "Invalid Studio command input".
- Never let a fade be zero long: `interpolate(t, [end - fadeOutSec, end], ...)`
  with fadeOutSec 0 throws (the range must strictly increase), and Studio
  reports only "Render execution failed". Guard with `Math.max(0.01, ...)`;
  for components uploaded before this rule, set the fade above 0
  (backdrop-blur v1/v2 failed this way, 2026-10-16).
- Register each code asset under ONE versionId per project (a second
  versionId for the same asset made renders fail, 2026-10-08).
- A change is a new upload under a new name (`-v2`); never repoint an
  existing name at different bytes. Studio enforces it: a name is bound to
  the first code it was registered with, in any project, and a registration
  of the same name with other code is refused with only "Studio command
  rejected" (2026-10-16, `reveal-serif-*-v1`). Update `registry.json` in the
  same commit.

## Adding or changing a component

1. Edit or add the source in `src/`; for a per-language build add a
   `VARIANTS` entry in `build.mjs`.
2. `node apps/mastra/studio-components/build.mjs`; it fails over 32768 bytes.
3. Upload `dist/<name>.tsx` with `shorts.assetUpload` (role `component`,
   mimeType `text/plain`, the build's sha256 and byte size), then PUT the
   bytes to the returned URL.
4. Record the returned reference in `registry.json` and the digest in
   `build.mjs`.
5. Test it in a throwaway project with one render before real use (the
   reveal-serif pair: `component-test-reveal-serif-20261016`).
