# Reflection sources

Place supported UTF-8 reflection sources here. Content-only files are eligible immediately after the next attempt reconciles the Workspace; they do not require frontmatter.

## Committed corpus

| File                      | Work                                                     | Coverage     | Granularity       | Licence                       |
| ------------------------- | -------------------------------------------------------- | ------------ | ----------------- | ----------------------------- |
| `ryle-luke.json`          | J.C. Ryle, _Expository Thoughts on the Gospels: Luke_    | Luke 1–24    | 144 sections      | Public domain (Ryle d. 1900)  |
| `ryle-matthew.json`       | J.C. Ryle, _Expository Thoughts on the Gospels: Matthew_ | Matthew 1–28 | 93 sections       | Public domain (Ryle d. 1900)  |
| `matthew-henry-mark.json` | Matthew Henry, _Commentary on the Whole Bible_           | Mark 1–16    | 16 whole chapters | Public domain (Henry d. 1714) |
| `matthew-henry-luke.json` | Matthew Henry, _Commentary on the Whole Bible_           | Luke 1–24    | 24 whole chapters | Public domain (Henry d. 1714) |
| `matthew-henry-john.json` | Matthew Henry, _Commentary on the Whole Bible_           | John 1–21    | 21 whole chapters | Public domain (Henry d. 1714) |

Sources: `https://ccel.org/ccel/ryle/matthew.xml` and `https://ccel.org/ccel/henry/mhc5.xml` (CCEL ThML, whose digital text is likewise free), and `https://gracegems.org/Ryle/` for Ryle on Luke, which CCEL does not carry in structured form.

**Granularity is why two sources overlap on Luke.** Ryle is one section per pericope (`Luke.19.1-Luke.19.10`, ~6,800 characters); Henry is one entry per chapter (`Luke.19`, ~62,800 characters). `matchReflection` pools every passage-keyed source and picks the **narrowest entry that covers the passage**, so Ryle answers a passage he has a section for and Henry answers everything else. The preference is span, never authorship — no code names either author, and document order cannot decide it (reconcile lists this folder alphabetically, which would otherwise put Henry first).

The JESUS film follows Luke, so `ryle-luke.json` is in practice the primary source and `matthew-henry-luke.json` the fallback. `ryle-matthew.json`, `matthew-henry-mark.json`, and `matthew-henry-john.json` are not reached by today's catalogue, which maps only Genesis (chapter 1) and Luke.

Matthew Henry is split one file per book: combined it is ~4.2 MB, larger than any other file committed in this repo and close enough to the 8 MB per-text-file inventory limit to be worth avoiding.

Regenerate from the public sources — no credentials, no local state:

```bash
node apps/mastra/src/scripts/ingest-ryle-luke.mjs
node apps/mastra/src/scripts/ingest-ryle-matthew.mjs
node apps/mastra/src/scripts/ingest-matthew-henry-gospels.mjs
```

Each writes straight into this folder. Provenance and licence go to stdout rather than into the documents, because the reflections schema is `.strict()` and this README is the only filename reconcile skips.

## Adding a source

A `.json` file must satisfy `ReflectionEntriesSchema` (`src/services/devotional/reflection-corpus.ts`) exactly: a top-level `{ entries }` and per-entry keys drawn only from `source`, `reference`, `osisRef`, `text`, `verse`, `book`, `chapter`. Both objects are `.strict()`, so one extra key — an `id`, a `sourceUrl`, a `count` — makes the whole file ineligible. Failures are reported and excluded rather than fatal, so an invalid corpus looks like a missing one. A `.md` or `.txt` file needs no shape: reconcile treats the whole file as a single entry.

A commentary volume needs **no code change**: `addReflection` (`src/services/devotional/workspace/attempt-data.ts`) puts every passage-keyed source into one pool, and `matchReflection` has no book allowlist, so a new volume makes its book servable on its own. That includes the Genesis prologue — chapter 1 of the catalogue is held out of the clip pool today only because nothing here covers it (`chaptersWithReflectionSource`), and a Genesis commentary would re-admit it. Genesis would also need its verses in `../scripture/web-bible.json` for the quoted verse to be exact rather than model-recalled.

**A theme-keyed source is different.** Spurgeon's _Morning and Evening_ is anchored to its own verse rather than to the passage a devotional is about, so it must never enter the passage-matched pool: there, a meditation on Luke 19:10 would be selectable as commentary on Luke 19 and presented as `flavor: "commentary"`. Routing keeps such a source thematic when its filename or `source` label contains `spurgeon`, or when it carries no `osisRef` at all — so name a thematic file accordingly, or omit `osisRef`. `ingest-spurgeon-morning-evening.mjs` still emits the pre-Workspace document shape and its output is therefore not eligible; see that script's header for what reaching the contract costs.
