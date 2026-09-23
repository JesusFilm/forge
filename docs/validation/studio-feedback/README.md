# Studio designer feedback regression

This fixture uses the real Manager `Preview`, `Timeline`, `Inspector`, and
`EditorSession`, the shared composition, and generated H.264 media. Its preview
API and revision store are local substitutes. It never authenticates to production
or reads real project assets. Generated media and rendered output stay in `.tmp/`.

From the repository root after `pnpm install --frozen-lockfile`:

```sh
# Requires FFmpeg with libx264. Optionally set FFMPEG_PATH to its executable.
node docs/validation/studio-feedback/prepare-media.mjs
node docs/validation/studio-feedback/serve.mjs
```

Open <http://127.0.0.1:4179>. The server delays each media request by 180 ms.
Click **Run cut playback**. Passing requires visiting all three cuts, reaching the
end, no unhandled errors, and a decoded visible video at every sampled frame in
the 25-frame window after each cut. The displayed samples include startup time
(from navigation to the first decoded frame), media requests, and peak mounted
video elements. This is a decoded-readiness assertion, not a pixel assertion.
Export black detection is a separate check.

Repeat playback and reload. Seek across cuts, use keyboard frame navigation, and
drag the playhead at minimum/maximum zoom and after scrolling horizontally. The
playhead must move continuously without changing the saved revision. Overlapping
text occupies separate selectable rows even though this fixture deliberately
stores it in the same legacy visual track as the video.

Select a text card to test fonts, shadow, stroke, scrim, and motion. Select the
second video to test transitions. **Save fixture**, **Reopen fixture**, **Undo**,
and **Redo** exercise the real editor session against a revision-checked in-memory
transport. Reloading the page resets this private fixture.

The server can run against an installed baseline checkout using
`STUDIO_QA_SOURCE_ROOT=/absolute/path/to/baseline`. Keep this harness from the
candidate checkout and point it at the baseline's source/dependencies. Baseline
`4ec1f98207d42a31187f51410fad3cfad7257746` has no preloading and visibly fails the
cut-readiness check. The original recorded failing frames were
90, 95, 99, 104, 182, 189, 196, 270, 274, and 279.

## Render comparison

With the fixture server still running:

```sh
node docs/validation/studio-feedback/render.mjs
```

This uses the same composition as the render service and an MP4 of the same
synthetic source (the production child remuxes retained HLS into MP4 before
Remotion). It creates a 390-frame movie, input JSON, and frames 15, 84, 90, 105,
and 195 in `.tmp/studio-feedback/artifacts`. All three bundled font families,
readability controls, entrance/exit motion and a 12-frame crossfade are included.

Open <http://127.0.0.1:4179/?render-case> to preview that exact document. Use the
playhead to compare the same frames with the exported PNGs. Text uses explicit
family/weight and is gated on font loading in both environments. Inter and
Montserrat are vendored Latin subsets; unsupported glyphs use browser fallback.
Apercu uses the existing vendored regular, medium, and bold faces. Existing font
names remain accepted for backward compatibility.

```sh
ffmpeg -i .tmp/studio-feedback/artifacts/feedback.mp4 \
  -vf blackdetect=d=0.03:pix_th=0.05:pic_th=0.92 -an -f null -
```

A crossfade/hard-cut sample must report no full-frame black interval. A deliberately
authored fade-through-black is a different test and is expected to reach black.
