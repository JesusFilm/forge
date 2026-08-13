# Devotional Video Studio — Plan

A daily devotional rendered as a portrait video: **hook → scripture → video →
reflection cards → questions + guided prayer**, in one chosen visual **style**,
one narrator voice, over an ambient music bed.

Non-linear: the blocks below are capabilities, not ordered steps. Build any in
any order; only Assembly consumes the rest.

## Principle: Style is a layer

One `style` preset (e.g. `warm-cinematic`, `sepia-film`, `noir-bw`) is chosen
from the video treatment and propagates to **every** card — palette, fonts,
grain, and music mood. Pick the video look and the whole devotional inherits it.

## Distribution (two cuts)

- **Website (full):** 2–3 min, the complete experience.
- **Social (short):** a trimmed teaser that drives viewers to the website.

## Blocks (→ roadmap tickets)

- **feat-286 Hook** — dedicated short-copy skill (≤~12 words, captivating).
  News (Firecrawl) → holiday → intriguing question. Always a curiosity hook.
- **feat-287 Scripture** — canonical NASB text via API.Bible (not model memory);
  styled card (left accent rule, distinct serif). Multilingual-ready.
- **feat-288 Audio** — owner-approved update: ElevenLabs D → E → C rotation,
  one voice per devotional; pre-generated reusable 20-track ambient library,
  mood-matched and ducked under narration. See the 2026-07-10 video-first plan.
- **feat-289 Video sourcing & trim** — match JF chapter; pull real clip (prod:
  Mux); transcript-based moment detection; fade in/out on the card.
- **feat-290 Style / theme system** — B&W / sepia / grain / cinematic filters;
  the chosen look drives card theme + music mood. Its own art-direction bot.
- **feat-291 Reflection** — Cru-sourced, adapted in our voice; varied per-card
  layouts (3-para → 1-para centered, highlighted phrases, bigger font), left-aligned.
- **feat-292 Questions + guided prayer** — strong open questions; a short guided
  prayer inviting the reader to talk to God about the topic.
- **feat-293 Assembly & distribution** — Remotion render, per-card audio sync,
  outro hold; emit full (2–3 min) + social-short cuts.

## Challenges (decide early)

- **Licensing:** NASB (Lockman) reuse terms; partner-devotional reuse; and
  explicit ElevenLabs account/license approval for music generation, storage,
  reuse, and distribution. Store provenance, but do not call it legal clearance.
- **Style consistency:** one style must read coherently across video, cards,
  and music — favor a small set of fixed presets over free-form.
- **Narration vs visual offset:** spoken line precedes its matching footage
  (~20s); the trim window must land on the visual, not just the words.
- **Multilingual (future):** voice, scripture text, captions, and music-neutral
  beds across ~2,000 JF languages.
- **Captions:** on-screen text for silent social autoplay + accessibility
  (Whisper word-timing follow-up).
- **Length discipline:** full 2–3 min vs social short — constrains card count.
- **Ownership:** generation in Mastra; render in worker/Remotion; publish +
  daily cron are deploy-side.

## Already built (local prototype, branch `feat/daily-devotional-generator`)

Hook/scripture/reflection/safety LLM pipeline, ElevenLabs voiceover and reusable
music-library selection, local JF-chapter matcher, partner (Cru) fetcher,
per-card audio sync, Remotion render with blurred background + video card +
outro hold, and a transcript-based snippet detector. See `devo/README.md`.
