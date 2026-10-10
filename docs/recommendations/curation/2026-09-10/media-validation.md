# Curated media link validation

All **233 editorial Core references**, including alternate cuts and excluded
choices, resolved in the isolated local Admin catalog. Their **233 HLS manifests
and 233 image links passed live HTTP checks** on 2026-09-10, 02:39:28–02:39:52 UTC.

The input is `admin-preview-source.json`, SHA-256
`8f3dac3ab7f4f3a77b89b92e733cd774a091506aa8c45a6a7b6736f73381d15b`.
`media-validation.json` records every Core ID, selected audio language, HTTP
status, content type, attempt count and timing. No credentials or private viewer
data are included.

## What was checked

- Every primary and alternate Core ID in the 208-choice editorial manifest.
- One published, nondeleted dub in a named language per reference, preferring
  English, with nondeleted Mux metadata and an available edition.
- An HTTPS image selected using the same authored-image precedence as curation.
- Playback manifest GET: successful HTTP status and valid HLS playlist markers
  in a bounded prefix. Image HEAD: successful HTTP status and an image MIME type.
- Four concurrent requests, a twelve-second timeout, and at most one retry for
  network errors, rate limiting or server errors.

This proves the selected links responded at the observation time. It does not
decode media segments, verify the spoken language, watch the films, test every
audio dub, or establish current production catalog publication. Excluded or
restricted choices remain excluded even when their public media links respond.
The earlier desktop/mobile browser checks separately established card rendering
and full-video navigation for the active preview contexts.

## Reproduce

Run from `apps/admin`, whose `.env` must point at the isolated preview database:

```bash
node --env-file=.env \
  ../../docs/recommendations/curation/2026-09-10/media-probe.cjs \
  /home/nisal/.cache/forge-477-preview/media-validation.json
```

The script refuses a database outside local `forge_feat477_20260910`, performs
metadata extraction in a repeatable-read, read-only transaction, and closes the
database connection before probing public resources. It does not import,
activate, publish or modify catalog data. A later run is a new observation of
mutable media resources.
