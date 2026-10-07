# Russian devotional playbook

How the Russian edition of a Daily Bible Pause long form is made, as approved
by the owner on Bartimaeus (JESUS film ch. 32, 2026-10-06/07). Read this with
`docs/devotional-shorts-playbook.md` (shorts) and the English storyteller path
(`apps/mastra/src/scripts/compose-storyteller.ts`).

## 1. Text: translate the approved English script, do not regenerate

The English script is already researched and fact-checked (storyteller path:
Ryle, Abbott-Smith, Easton/Smith, Edersheim, BSB). The Russian edition is a
careful translation of that approved script, paragraph by paragraph, keeping
each paragraph's role, voice, source mark and callout. It is written into the
localized cache `devo/cache/ch<N>-seq<M>-ru/devo.json` (the render reuses a
cached localized text instead of machine-translating).

Rules:

- Address the viewer as "ты"; gender-neutral phrasing where English says
  "you stopped..." ("просьба, которую ты давно уже не произносишь вслух").
- No тире (dashes): colons and full stops instead.
- Scripture is the Synodal text, never translated. Psalm numbers differ from
  the English Bible by one (BSB Ps 145 = Synodal Ps 144).
- Re-check the insight against the Russian Bible. Bartimaeus: the English
  insight was "healed" really means "saved"; the Synodal Luke 18:42 already
  says «вера твоя спасла тебя», so the Russian turns on «не просто вылечила,
  а спасла».
- Source marks in Russian: «Комментарий · Дж. К. Райл (1816–1900)»,
  «Язык оригинала · Греческий словарь Эбботт-Смита».
- Numbers in words where spoken («в сорок втором стихе»).
- The opening follows the same rules as English (hook, a full preview
  sentence, a line to the viewer, one key word through a story), and the
  preview says «В этом видео мы...», never «В этом размышлении».

Give the owner the script sheet to read before any voice is recorded.

## 2. Film

The JESUS film's Russian dub (Arclight language 3934). Its Arclight cues carry
line timing only, so a chapter gets a local cue file with whisper word times:
`apps/mastra/src/services/devotional/video-sources/jesus-ch<NN>.ru.vtt` and
`.ru.words.json` (whisper `ggml-small` with `-l ru -ml 1 -sow -dtw small`;
words whisper missed are spread by length inside their cue; each cue starts
where its speech starts, the dub's track sometimes lags a second). Fix obvious
typos in the cue text. The render picks the local file up automatically.

## 3. Voices

- Male: JFvoice_Rus (`russian`) on Eleven v4: opening, insight, question,
  prayer.
- Female (reflection): Kate (`russian-female`, 7G0NvIkWRnU0Dqjgz13p). She is
  generated ~12 dB under the male voice; the render levels each voice
  (cap 16 dB).
- Opening in TWO voices (`--hook-voices`), the lines alternating male and
  female; Bartimaeus used Tatyana Voloshina (nkvv6waLzFah2jTNUZGT) for the
  female lines. Each line is levelled, cut to its words and placed by its
  measured length.
- Stress: pins in `RU_LOCALE.stressOverrides` (combining acute, U+0301)
  reach the continuous v4 read. Names to watch: Лука́, сто́ит (is worth).
- Paragraph direction tags (English, e.g. `[thoughtful]`) work in Russian
  text and are never spoken.

## 4. Render

```bash
pnpm exec tsx --env-file=.env.local src/scripts/render-one-devotional.ts \
  --chapter=<N> --seq=0 --lang=ru --aspect=wide --structure=clip-first \
  --intro=montage --hook="<RU opening lines>\n\nДавай посмотрим." \
  --hook-voices=russian,<female id>,russian,<female id>,russian \
  --intro-shots=<s,s,s,s> --intro-kinetic="0=<hero>/<accent>/left;..." \
  --hook-gap=0.15 --mark-layout=side --steps --text-font=serif --word-timings \
  --voice-v4 --approve --bg-rate=0.7 --bg-from=<s> --music-file=<bed> --out=<dir>
```

What the Russian locale already does (`devotional-locale.ts`): steps
ПОСМОТРИ · ПОДУМАЙ · ПОМОЛИСЬ (the big step word shrinks to fit), «Давай
посмотрим / подумаем, что значит эта история / принесём это Богу», «Сначала
спроси себя:» / «Поговори об этом с Богом:», no kicker under the Jesus Film
mark, no translation name on the verse address.

Cyrillic traps fixed so far (all were ASCII-only regexes that silently failed):
kinetic opening captions, verse-callout highlight, the preview-line test.
Check any NEW text feature with a Russian line before trusting it.

## 5. Fixing one word after the render

Re-voice only that card's sentence, fit it to the old file length exactly
(atempo up to 1.2, `apad=whole_dur`), update the cached takes, then run the
same render command with `--audio-only`: the soundtrack is rendered alone and
muxed under the existing picture (the old file is kept beside it).

## 6. Deliverables

`devo_h_<story>_ru.mp4`, `script_<story>_ru.txt`, `captions_<story>_ru.txt`
(+ `.rtf`), Russian covers in Figma (row under the English ones; a title font
without Cyrillic, such as Poppins, is swapped for Montserrat) exported to
`covers/ru/`, shorts in `shorts/ru/`.
