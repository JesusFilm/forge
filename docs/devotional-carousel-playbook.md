# Daily Bible Pause carousels (YouTube Community)

The image carousel that goes out as a YouTube Community post (EN + RU), one per
story, usually the Saturday "fact" slot of the Community test. Written from the
Peter's Confession carousel, which went through three rounds with the owner and
one outside review on 2026-10-29. Read this before drafting a carousel, and
add to it when the owner corrects one.

Shorts have their own playbook: `docs/devotional-shorts-playbook.md`.

## 1. Story: every card hands a question to the next

A carousel is not four slides of facts. Each card answers the question the
previous card raised and raises the next one. Before you show a draft, check
every card against one question: **does this card give the reader a reason to
swipe?** If a card only adds information, rewrite it until it opens something.

The arc that worked (Peter's Confession, "Christ"):

| Card        | Job                                                       | Example                                                                                                              |
| ----------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1 Hook      | A question built on a common assumption. Not a statement. | Is "Christ" Jesus' last name?                                                                                        |
| 2 Discovery | Answer card 1, then open a new question.                  | Not a name. A title. ... Both mean one thing: _anointed_. But anointed for what?                                     |
| 3 Context   | Show why it mattered, then lead into a scene.             | Kings, priests and prophets were anointed ... Then Jesus stood up in the synagogue and read: _"He has anointed Me."_ |
| 4 Payoff    | Say what it means in the story, then turn to the viewer.  | When Peter said "The Christ of God," he meant ... But the question was not only for Peter: _"Who do you say I am?"_  |

Rules that came out of the review:

- Open with a question, never a flat statement ("Christ is not a last name"
  read as a lecture; "Is 'Christ' Jesus' last name?" made people swipe).
- Do not give the whole answer on card 2. The ending must add a meaning, not
  repeat the translation from card 2.
- End on the viewer, not on the fact: Daily Bible Pause is about the viewer's
  own answer.
- Plain sentences over textbook ones ("oil on the head meant God had set a
  person apart" became "It meant God had chosen them for a task").

## 2. Pictures follow the words

- The card shows whoever the text is about: Peter's words over Peter, the
  anointing over the scene where Jesus reads "He has anointed Me" (JESUS film
  ch. 6, Nazareth synagogue), the hook over Jesus.
- Look beyond the story's own chapter for a still that fits (the Arclight
  chapter list is in `apps/mastra/src/services/devotional/jesus-film-catalog.ts`;
  download a chapter with `https://api.arclight.org/v2/media-components/1_jf61NN-0-0/languages/529?platform=web`).
- A language card (a Greek or Hebrew word) sits over a blurred picture with a
  dark wash; the word itself is drawn large in the original script
  (Χριστός, מָשִׁיחַ) with the transliteration small under it.
- Text never covers a face. Put the text block at the bottom with the shade,
  and move the picture so the face sits in the top half.

## 3. Type

- Body text: white Inter (Medium), easy to read. The owner found long lines in
  gold Literata hard to read.
- Gold Literata Bold Italic only for the one or two words that carry the card
  ("anointed", "He has anointed Me", the closing question).
- Verse references: small gold Inter Bold caps above the text block.
- Card 1 gets a small "Swipe →" / "Листай →" at the bottom right.
- No em or en dashes anywhere. RU addresses the viewer without gendered past
  forms.
- The owner edits the RU cards in Figma herself; mirror her styling onto EN
  rather than overwriting it.

## 4. Facts

- Only facts you can source: Easton (1897) and Smith (1863) Bible dictionaries,
  Abbott-Smith, the BSB text (`devo/corpus/`). The RU cards quote the Synodal
  text. Put the sources at the bottom of the captions file.
- Lines must be literally true to the passage (Peter's words are "The Christ of
  God" in Luke 9:20 BSB).

## 5. Files and hand-off

- Figma file `sH8roRBVKAyzumI4lKm9T2`, page Grid, frames named
  `Community post / <story> / fact / EN|RU / 1-4`, 1080x1350.
- Send Figma links and a preview first. Export JPGs only after the owner's OK,
  to `<Story>/community/en_1..4.jpg`, `ru_1..4.jpg`.
- `<Story>/community/captions_community_fact.txt`: the one-line post text EN
  and RU (the hook again, plus "Swipe to see ..."), an optional second line
  with the long-form link, the card texts, sources.
- Hand off to Publishing with a READY TO PUBLISH line in the story README.
  Saturday posts must be scheduled by Friday. Tell Calendar.

## 6. Outside review

Run the draft past the creative review (Claude writes, GPT reviews) before it
goes to the owner:

```bash
cd apps/mastra
pnpm exec tsx --env-file=.env.local src/scripts/creative-review.ts \
  --kind=carousel --lang=en --file=<draft.md> --out=<dir> --revise
```

It writes `review.md` (what the reviewer found), `revision.md` (the revised
draft and which suggestions were taken and why) and `review.json`. Paste
`review.md` into the review doc's "Review" tab so the owner sees both. The
reviewer does not know the house rules as well as we do: never take a
suggestion that breaks section 3 or 4.
