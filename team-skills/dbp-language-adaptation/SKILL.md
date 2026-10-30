---
name: dbp-language-adaptation
description: Adapt an approved English Daily Bible Pause script into another language (first Russian), and review an adaptation as a language team. Use whenever a language team receives an approved English master, translates or checks a script, Shorts or captions in its language, or asks what it is allowed to change. Covers the frozen-meaning rule, the review flow and the Russian rules.
---

# Daily Bible Pause: adapting the master script

Every story has one English master script, approved by the story owner. Each language is a variant of it, not a new script. The picture, edit, film clips and Shorts set are shared; each language changes only the voice, subtitles and on-screen text.

## The frozen-meaning rule

Once the owner approves the English master, its meaning is frozen. Nobody changes it, for their own language or for everyone.

A language team may only:

1. **Make local wording changes, in its own language only.** When an idiom or example does not land in its culture, swap it for a close one with the same point. Mark it `LOCAL:` in the review doc with one line on why. It never reaches other languages. The team's lead approves it.
2. **Send suggestions for the future.** If a point seems off, comment to the story owner. This video ships as is; later stories take it into account.
3. **Report real errors** (wrong verse, wrong fact) to the story owner before release. Only the owner fixes the master, and the fix reaches every language.

## How to adapt

- Translate paragraph by paragraph, keeping each paragraph's role (opening, insight, commentary, conclusion, verse, question, prayer), its voice and pauses, its verse cards and source marks.
- Say it the way a native speaker would, not word for word. Tell feelings plainly, step by step, as what the person does and feels.
- Scripture comes from the language's own Bible, never translated from English. The translation must allow text-to-audio use; check its licence before the first episode.
- Where the reflection quotes the film, use the words the film's dub actually says in that language.
- Re-check the insight against the language's Bible: sometimes it already says what the English insight explains, and the line must turn on that.
- Numbers spoken in words. No em or en dashes. All house rules from `dbp-script` still apply.
- Adapt the Shorts and captions in the same pass, so they match the script.

## Review flow

1. The agent adapts the approved master into the language tab of the story's Claude Doc.
2. The language team reads it in the doc and comments: language fixes are made at once; `LOCAL:` changes are approved by the team lead; meaning questions go to the owner.
3. The team approves its tab, then renders its variant (see `dbp-shorts` and the team's Studio Manager setup).

## Language specifics

- Russian: `references/russian.md`.
- A new language: copy that file, fill in its Bible translation, film dub, address form, passage label and source marks, and get the owner's OK on one sample episode first.
