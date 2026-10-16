# Recipe: a vertical Daily Bible Pause devotional in Studio Manager

For a teammate's Claude (Claude Code with the `shorts-creator` skill and the
Forge Shorts MCP). Result: an editable 9:16 project in Studio Manager
(`https://manager.jesusfilm.org/dashboard/shorts/<projectId>`) that a person
reviews and fixes in the editor. Reference project, built 2026-10-15 from the
Persistent Widow long form: `widow-devotional-vertical-en-20261015`.

Components live in Studio already; their exact registration blocks are in
`apps/mastra/studio-components/registry.json`. Nothing on
anyone's laptop is needed.

## Inputs the person gives you

1. The story and passage (e.g. Luke 18:1-8) and the language (English or
   Russian).
2. The approved script: four opening lines, the reflection paragraphs (one
   of them may be the "insight": a history or word note with its source), the
   takeaway line, the closing verse (Berean Standard Bible for English,
   Synodal for Russian), one question and one prayer.
3. Which LUMO scene to use. Search `shorts.search` with the title form
   `LUMO - Luke 17:1-18:8` (the Gospel of Luke is split into segments; search
   by chapter). LUMO has no subtitle track: capture with `trackId: null`.

Ask only for what is missing. Never invent Scripture wording: the film's lines
are the NIV as the narrator reads them; the closing verse is quoted exactly.

## Timeline (about 3 to 5 minutes, 30 fps, 1080 x 1920)

| Part                     | Picture                                                     | Text / component                                                                                                                                     | Voice                                               |
| ------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Opening, 15-20 s         | 4 film shots, one per line, muted                           | `Caption-orange` (RU: `kinetic-ru-v1`) per line, `bottomPercent` 38; `dbp-mark-v1` at top 230                                                        | narrator, lines alternate between two voices        |
| "WATCH"                  | last opening shot                                           | text "WATCH" Inter 700 90, gold #f2c46b                                                                                                              | "Let's watch."                                      |
| The scene                | the LUMO passage with its own sound                         | one `Caption-orange` per Bible line                                                                                                                  | film                                                |
| "REFLECT"                | slow film shots (playbackRate 0.7), `film-look-v1` dim 0.45 | text "REFLECT"                                                                                                                                       | "Let's look more closely at what this story means." |
| Reflection               | slow film shots                                             | one `reveal-serif-en-v1` (RU `-ru-`) item per sentence: fontSize 60, width 760, top 960, colour #f4efe8, highlight = the sentence's key phrase or "" | reflection voice                                    |
| Insight credit           |                                                             | small gold text at y -560: "HISTORICAL CONTEXT" + source and year, ~5 s                                                                              |                                                     |
| Verse referred to        |                                                             | the verse at y -470 (Apercu 38) while the reflection talks about it; move the sentence down (top 1140)                                               |                                                     |
| Takeaway                 |                                                             | one `reveal-serif` item, fontSize 64                                                                                                                 |                                                     |
| Closing verse            |                                                             | the verse + "ROMANS 12:12 · BSB" in small gold caps                                                                                                  | calm                                                |
| "PRAY", question, prayer |                                                             | labels "FIRST, ASK YOURSELF" / "TALK TO GOD ABOUT IT" in gold caps, question and prayer as `reveal-serif`                                            |                                                     |
| End                      |                                                             | `dbp-mark-v1`                                                                                                                                        |                                                     |

Tracks, bottom to top: `clips` (visual), `look` (visual), `captions`,
`cards`, `brand` (caption), `voice` and `music` (audio).

## Steps

1. `shorts.create` an EMPTY project (no items; large creates fail), with the
   registry's `registration` blocks in `components`.
2. `shorts.capture` the LUMO segment (`trackId: null`, highest download).
3. `shorts.apply` items in batches of about 25 (`insert-item`).
4. Voice: put the spoken text on the text/component items with `set-speech`,
   using an APPROVED voice preset from `shorts.assets` (role `voice`).
   `shorts.narrationQuote` to see the cost; tell the person the price before
   `shorts.narrate`. One initial pass plus one correction per project, so get
   the script right first.
5. Read the project again and fit each sentence's item to its narration.
   Without word times, `reveal-serif` spreads the words evenly over the item.
6. Hand over the editor link. Render only if the person asks.

## House rules (from the owner)

- Safe zones: no text in the top 270 px, nothing below 1450 px, keep text left
  of x 920 in the band y 880-1500 (the like/comment rail).
- No em or en dashes in on-screen text or captions.
- Russian text addressed to the viewer is gender-neutral ("больше не
  приходишь", not "перестал").
- Credits go on screen as small gold lines and in the post caption: film
  (LUMO, Jesus Film Project, narration NIV), the closing-verse translation, the
  commentary or source with its year.
- Do not reuse the previous devotional's music; the team keeps a list of beds.

## Voices

Studio has one approved English preset so far ("Bella"). The series voices
must be registered as presets by a person in Studio (it cannot be done by an
agent): ElevenLabs voice ids female-d `98ujrzs7rxAMEsaC4EpW`, male-e
`xLeLcqgjUx3wQJFSESKj` (English); Tatyana Voloshina `nkvv6waLzFah2jTNUZGT`,
Ivo `hD8aK7CmEPgH3mbFO08e` (Russian).
