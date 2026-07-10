---
date: 2026-06-11
topic: manager-shorts-studio
---

# Manager Shorts Studio — vertical shorts from library videos via Remotion

## Problem Frame

JFP's library holds thousands of long-form videos, but social distribution
(TikTok, YouTube Shorts, Instagram Reels) needs vertical clips with burned-in
animated captions and audio-waveform visuals. Producing these today requires a
video editor and manual per-clip work, so almost none get made. Admins should
be able to turn any library video into an on-brand vertical short themselves,
in minutes, from a new section inside the manager app. Remotion is the
compositing engine (programmatic React-based video, agent-friendly templates).

## Requirements

- R1. New manager dashboard section ("Shorts") with a list of all shorts jobs
  (status, source video, preview, download) and a "create short" entry point.
- R2. Admin selects any source video from the library (same asset-based
  identity model used by enrichment and Smart Crop jobs).
- R3. Clip selection is manual in the MVP: admin scrubs the source video and
  sets in/out points against a live player, with sane duration guardrails
  (roughly 5s–180s). AI-suggested highlight moments are an explicit
  fast-follow, not MVP.
- R4. Vertical 9:16 framing offers two simple modes — center-crop (with a
  horizontal offset control) and fit-with-blurred-background. If an approved
  Smart Crop 9:16 render already exists for the source video (feat-173), the
  admin can use it as the source instead. Loose coupling: shorts must work
  without Smart Crop.
- R5. Captions are word-level: the selected clip's audio is AI-transcribed to
  word timestamps so captions animate word-by-word ("karaoke" style, TikTok
  convention). The admin can review and edit the caption text before
  rendering; edits keep their timing.
- R6. Composition uses a starter set of 2–3 hand-built branded Remotion
  templates, each combining the clip, animated captions, an audio-waveform
  visual, and optional title/hook text. Each template exposes safe style
  knobs (caption font/color/position, waveform style, accent color). New
  templates are added by developers in code.
- R7. The admin sees an interactive preview of the composed short (template +
  captions + knobs applied) before committing to a render, and can iterate
  on knobs/captions without re-running transcription.
- R8. A finished render produces both: a new Mux asset linked to its source
  video, and a downloadable MP4 suitable for direct upload to
  TikTok/Shorts/Reels.
- R9. Short creation runs as a durable job consistent with existing manager
  jobs: visible progress, explicit failure states, and retry that reuses
  already-produced artifacts (e.g. transcription) instead of repeating work.

## Success Criteria

- An admin with no video-editing skills goes from "library video" to a
  rendered, downloadable, on-brand 9:16 short with burned-in word-level
  captions and waveform in a single sitting, with no engineering help.
- Caption animation quality is comparable to mainstream TikTok/Shorts
  caption styles (word-pop timing, readable, on-brand).
- A failed render is retryable without losing caption edits or re-paying for
  transcription.
- Shorts created are discoverable later (list view per R1) rather than
  one-shot downloads that vanish.

## Scope Boundaries

- No AI highlight suggestion in MVP (fast-follow; we already store scene
  analysis + transcripts that can power it).
- No publishing/scheduling to social platforms — distribution stays manual.
- 9:16 only; no 1:1 or 16:9 template variants.
- Single contiguous clip per short — no multi-segment montage/mixing in MVP.
- No subject-aware frame tracking inside this feature (that is Smart Crop's
  job; this feature only consumes its output when available).
- No agent-generated or admin-authored templates in MVP (developers add
  templates in code; natural-language template generation per Remotion's
  AI-agent docs is a possible v2).
- No admin schema changes expected (job state should follow the existing
  manager job patterns).

## Key Decisions

- Manual in/out clip selection first, AI suggestions later: ships the core
  value (composition + captions) without coupling MVP to a recommendation
  model.
- Simple framing + opportunistic Smart Crop reuse: avoids hard dependency on
  feat-173 (still in production testing) while leaving the door open for
  subject-aware framing.
- Word-level AI transcription over reusing stored sentence-level subtitle
  cues: the word-pop caption style is the product; phrase-level cues can't
  deliver it. Transcription is clip-length only, so cost stays small.
- Mux asset + download both: library traceability plus zero-friction handoff
  to whoever posts on social.
- Starter template set with style knobs: consistent brand output with enough
  variety, without building a template editor.
- Remotion as the compositing engine: programmatic React templates, strong
  caption/waveform tooling, and agent-friendly for future template work.

## Dependencies / Assumptions

- Remotion requires a paid company license for organizations over 3 people —
  procurement needs to happen before this ships (low cost, but non-zero
  lead time; verify ministry/non-profit terms).
- Source videos are Mux-hosted with renditions accessible for clip preview
  and for the render pipeline.
- Remotion server-side rendering is resource-heavy (headless Chromium); per
  repo law all heavy media work runs outside manager's process. The repo
  already has the manager/mastra/worker decomposition and an artifact
  storage pattern (Smart Crop, feat-173) to model this on.
- Existing transcription/AI infrastructure (mastra) is assumed reusable for
  word-level transcription of short clips.

## Outstanding Questions

### Resolve Before Planning

(none)

### Deferred to Planning

- [Affects R9][Technical] Does Remotion rendering live in an extended
  crop-worker or a new dedicated worker app? (Chromium + Remotion bundle is a
  very different runtime footprint from FFmpeg.)
- [Affects R5][Technical][Needs research] Transcription provider for
  word-level timestamps (Whisper via Remotion's tooling vs existing mastra
  transcription path), including non-English source languages.
- [Affects R7][Technical] How the interactive preview is delivered in the
  manager UI (Remotion Player with Mux playback URLs vs server-rendered
  preview frames), and how preview parity with the final render is kept.
- [Affects R4][Technical] How "an approved Smart Crop render exists" is
  detected and surfaced to the admin at source-selection time.
- [Affects R6][Technical] Template props/knob schema and how template
  versions are recorded on finished shorts for reproducibility.
- [Affects R8][Technical] Where the source-video → short linkage is recorded
  so the shorts list (R1) can show provenance without admin schema changes.

## Next Steps

→ `/ce:plan` for structured implementation planning
