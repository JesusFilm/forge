# Reflection sources

Place supported UTF-8 reflection sources here. Content-only files are eligible immediately after the next attempt reconciles the Workspace; they do not require frontmatter.

## Committed corpus

| File                      | Work                                                     | Coverage     | Licence                       |
| ------------------------- | -------------------------------------------------------- | ------------ | ----------------------------- |
| `ryle-matthew.json`       | J.C. Ryle, _Expository Thoughts on the Gospels: Matthew_ | Matthew 1–28 | Public domain (Ryle d. 1900)  |
| `matthew-henry-mark.json` | Matthew Henry, _Commentary on the Whole Bible_           | Mark 1–16    | Public domain (Henry d. 1714) |
| `matthew-henry-luke.json` | Matthew Henry, _Commentary on the Whole Bible_           | Luke 1–24    | Public domain (Henry d. 1714) |
| `matthew-henry-john.json` | Matthew Henry, _Commentary on the Whole Bible_           | John 1–21    | Public domain (Henry d. 1714) |

Both works were ingested from CCEL's ThML editions, whose digital text is likewise free: `https://ccel.org/ccel/ryle/matthew.xml` and `https://ccel.org/ccel/henry/mhc5.xml`.

Matthew comes from Ryle and Mark/Luke/John from Matthew Henry because CCEL hosts Ryle's Matthew volume only in this form. Matthew Henry is split one file per book: combined it is ~4.2 MB, larger than any other file committed in this repo and close enough to the 8 MB per-text-file inventory limit to be worth avoiding. Every filename keeps `henry` because `addReflection` (`src/services/devotional/workspace/attempt-data.ts`) routes by source path; reconcile concatenates all reflection files regardless.

Regenerate from the public sources — no credentials, no local state:

```bash
node apps/mastra/src/scripts/ingest-ryle-matthew.mjs
node apps/mastra/src/scripts/ingest-matthew-henry-gospels.mjs
```

Each writes straight into this folder. Provenance and licence go to stdout rather than into the documents, because the reflections schema is `.strict()` and this README is the only filename reconcile skips.

## Adding a source

A `.json` file must satisfy `ReflectionEntriesSchema` (`src/services/devotional/reflection-corpus.ts`) exactly: a top-level `{ entries }` and per-entry keys drawn only from `source`, `reference`, `osisRef`, `text`, `verse`, `book`, `chapter`. Both objects are `.strict()`, so one extra key — an `id`, a `sourceUrl`, a `count` — makes the whole file ineligible. Failures are reported and excluded rather than fatal, so an invalid corpus looks like a missing one. A `.md` or `.txt` file needs no shape: reconcile treats the whole file as a single entry.

**Before adding a thematic source keyed to its own verses** (a daily devotional rather than a passage commentary), fix reflection routing first. `addReflection` routes by `osisRef` book prefix before it considers the filename, so entries on Matthew land in the Ryle corpus and entries on Mark/Luke/John land in the Matthew Henry corpus no matter what the file is called. For Spurgeon's _Morning and Evening_ that is 123 of 732 entries. The Matthew Henry side is inert — it matches whole-chapter references like `Luke.19`, which no verse-keyed entry has — but the Ryle side is verse-range matched, so a thematic entry can be selected and presented as `flavor: "commentary"`. What hides it today is filename ordering (`ryle-matthew.json` sorts before any `spurgeon-*` name, so real Ryle sections win the lookup), which is an accident rather than a guarantee. See the header of `src/scripts/ingest-spurgeon-morning-evening.mjs`.
