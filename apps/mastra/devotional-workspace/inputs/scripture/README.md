# Scripture sources

Place supported UTF-8 `.json`, `.md`, `.txt`, `.yaml`, or `.yml` scripture sources here.

## Committed corpus

`web-bible.json` holds the World English Bible (WEB, public domain) for Matthew, Mark, Luke, John, and Acts — 4,782 verses, the books the JESUS-film clips draw on. It exists so devotional scripture is the exact verse text rather than model-recalled wording; `lookupVerse` returns `null` for anything outside this set and the caller then flags the passage unverified.

Ingested from getbible.net v2 (`https://api.getbible.net/v2/web`). Regenerate from the public source — no credentials, no local state:

```bash
node apps/mastra/src/scripts/ingest-web-bible.mjs
```

It writes straight into this folder. Provenance and licence go to stdout rather than into the document: `WebBibleSchema` (`src/services/devotional/web-bible.ts`) is `.strict()` on `{ verses }` alone, so a translation or licence envelope would make the corpus ineligible, and this README is the only filename reconcile skips. Verse keys are osis form (`Luke.19.5`) to match reflection-corpus routing.

Until 2026-08-17 this file was a single-verse placeholder, which left every passage but John 3:16 on model-recalled text. Replacing it was the "migration must populate the public-domain WEB corpus" precondition this README used to carry.
