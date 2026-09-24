# Studio designer feedback — working plan

Tracking: `docs/roadmap/media-generation/feat-534-studio-designer-feedback-triage.md`.
Current phase: implementation and local verification complete; preparing the reviewed PR.
Results and evidence limits: `docs/validation/studio-feedback/results.md`.

## Working agreement

The user asked the agent to manage this process and explicitly directed it to
match Lyuba's instructions as closely as possible. Her written requests are the
design authority; the sketch supplies layout and overlap intent. The user has
little design opinion and does not want routine design choices escalated.

The agent owns investigation, delivery order, routine implementation choices,
verification, and roadmap upkeep. Ask only when a material ambiguity cannot be
resolved from Lyuba's feedback, the sketch, existing behavior, or a reversible
implementation choice. Do not ask the user to approve the already-requested
Video / Audio / Text separation or draggable playhead again.

Recommended delivery order is playback reliability, timeline UX, fonts/readability,
text animation, then clip transitions. This order is an agent execution choice;
it does not imply a user deadline or a new feature request. No external messages
or production publishing outside the normal PR workflow are authorized.

## Correct implementation

Inspected current main at `4ec1f9820` on September 23. The original checkout was
`3f9c88339` (September 2), containing the old Shorts Studio. Work now lives on
`codex/shorts-designer-feedback`, based on current main in a separate worktree.

The current editor is `apps/manager/src/features/video-studio/`, reached through
`/dashboard/shorts`. The completed feat-456 delivered its baseline. Historical
references to `features/shorts` are not current implementation targets. Existing
feat-462 covers replacement release, not this entire incoming feedback batch.
Railway confirms the production editor URL is
`https://manager.jesusfilm.org/dashboard/shorts`. The project in the recording is Pharisee cold open, revision 6
(`50283581-ced8-42f8-980c-097be7a6c5fc`). The exact deployed commit still needs verification.

## Source material and evidence limits

- Designer feedback supplied by the user: completed a project using Chrome;
  Opera agent access failed; an earlier agent mistakenly edited an old local editor.
- Reported symptom: black flashes during playback across adjacent clips;
  a paused frame at the cut is correct. Cause and final-render behavior unverified.
- Supplied sketch: video/audio/text groups with overlapping items and a draggable
  vertical playhead. Text says only play/pause below preview; sketch also draws
  skip controls, so use the text preference as the initial proposal.
- Session attachment: `Screen Recording 2026-09-22 at 13.19.04.mov`, attachment
  ID `76db2189-604c-400b-bb2a-d8d830bcb25f`. Decoded and reviewed; measurements below.
- Session attachment: `Screenshot 2026-09-22 at 13.43.23.png`, attachment
  ID `5377f8c6-dbfc-46a2-93d9-81479550f8d8`; sketch visible in conversation.
- Attachments are local to this session, not committed repository evidence.

## Initial triage queue (historical)

These were the initial investigation questions. The implementation briefs below and verification report supersede these states.

| Order    | Scope                                    | Category / proposed state  | Evidence and next action                                                                                                                                                                    |
| -------- | ---------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Black flashes at cuts                    | bug / needs-triage         | Recording confirms black intervals; live playback confirms missing decoded media at the first cut. See feat-535; export remains unchecked.                                                  |
| 2        | Timeline track organization and playhead | enhancement / needs-triage | Current playhead has no pointer handlers; ruler/empty track clicks seek. Add Track always adds `visual`. Agree groups and overlap behavior, then prototype if needed.                       |
| 3        | Fonts and text readability               | enhancement / needs-triage | Text schema and composition support font family/weight, but the inspector lacks a font picker. Decide initial fonts and shadow/stroke/scrim controls; verify loading in preview and render. |
| 4        | Text animation                           | enhancement / needs-triage | No built-in animation fields in text schema. Define initial presets, timing, and preview/export parity. Custom components are a separate capability.                                        |
| 5        | Clip transitions                         | enhancement / needs-triage | Define initial transitions and overlap/duration semantics; inspect full render contract before selecting a representation.                                                                  |
| Separate | Browser/agent access guidance            | bug / needs-info           | Chrome success and Opera failure are reporter observations. Get exact failed access behavior before attributing it to editor or extension.                                                  |

## Initial source findings (before implementation)

- `apps/manager/src/features/video-studio/timeline.tsx`: tracks render individually
  with kind labels; `nle-playhead` only renders its position. Clip dragging exists,
  which is distinct from dragging the playhead.
- `apps/manager/src/features/video-studio/editor.tsx`: transport below the preview
  includes go-to-start, play/pause, and a separate Playhead range input.
- `packages/studio-contracts/src/index.ts`: `studioTrackSchema` currently accepts
  `visual`, `audio`, `caption`. `StudioTimelineItem` includes video, audio, image,
  text, and component. A product Text group need not imply a new persisted kind;
  decide grouping versus document migration after examining validation semantics.
- `studioTextPropertiesSchema` supports color, size, family, weight, and alignment;
  no built-in shadow, stroke, scrim, animation, or transition fields here.
- `packages/shorts-compositions/src/studio/Composition.tsx` renders text and media
  in sequences and has browser HLS and render video paths. Their existence is a
  diagnostic entry point, not proof of the black-flash cause.
- Related knowledge: `docs/solutions/security-issues/shorts-browser-preview.md`,
  `docs/solutions/security-issues/studio-legacy-shorts-retirement.md`, and
  `docs/solutions/database-issues/studio-command-revisions-and-publication-latch.md`.

## Accepted design direction and implementation defaults

- Present three clearly labeled groups, in the sketch's order: Video, Audio, Text.
  Each group accommodates overlapping items on separate rows. Preserve existing
  composition ordering and project content; visual grouping must not silently
  change which layer appears on top.
- Video group contains footage (and existing image/custom visual content); Audio
  contains audio clips and music; Text contains text items. Do not automatically
  detach video sound or generate new audio items: Lyuba did not request this.
- Make the vertical playhead itself continuously draggable across the timeline,
  with an easy-to-grab handle, ruler seeking, and correct zoom/scroll mapping.
- Keep only play/pause under the preview. Her written preference overrides the
  sketch's extra skip icons. Put time/frame readout and keyboard-accessible seek
  affordances with the timeline; preserve useful playback shortcuts.
- Expose a font picker and weight controls. Start with existing vendored Inter,
  Montserrat, and Apercu where supported, showing the same fonts in preview and
  render. Preserve old font values; do not silently restyle existing text.
- Provide independently adjustable text shadow, stroke, and a text-local scrim.
  Defaults remain off on existing text. A scrim belongs behind the text rather
  than dimming the entire video. Reuse existing Manager colors for the editor UI.
- Provide small, discoverable text entrance/exit animation presets with duration
  controls. None, fade, and slide are initial agent-selected defaults, not named
  requests from Lyuba. Evaluate at timeline frames so paused seeks match export.
- Provide clip transitions at adjacent video cuts, initially None, crossfade, and fade through black,
  with duration controls. These are agent-selected defaults; do not impose a
  transition on existing cuts or change text/audio timing as a side effect.
- Browser-agent onboarding remains a separate investigation. Chrome is verified
  here; do not claim Opera support or blame its extension without evidence.

## Implementation briefs

- feat-535: preview continuity at video cuts.
- feat-536: separately observed playback React error.
- feat-537: grouped timeline and direct playhead control, matching the sketch.
- feat-538: font selection and text readability treatments.
- feat-539: text entrance/exit animation controls.
- feat-540: transitions between adjacent video clips.

Execution order is not a dependency by itself. No blocking edges are declared
until a concrete contract dependency is established. These tickets share the user-authorized designer-feedback scope and ship together because the shared preview, timeline, and text contracts are verified together.

## Delivery and verification gates

1. Reproduce the cut issue on the current editor. Record project revision, browser,
   source types, cut timestamps, and cold/warm playback behavior. If a fixture is
   sufficient, use it; do not label a synthetic test as reporter reproduction.
2. Follow the accepted designer-led scope and separate roadmap briefs; keep any
   established dependencies bidirectional.
3. Implement and review the authorized designer-feedback scope in one PR. Preserve revision-checked saves, undo,
   project reopen, and existing project compatibility.
4. For playback, verify actual decoded frames across cuts, repeated seeks, and
   preview versus output. For timeline, verify continuous drag at different zoom
   and scroll positions, keyboard access, and overlapping items.
5. For fonts/effects, verify identical font availability and timing in preview and
   render. Measure page-load impact when frontend initialization or media changes.
6. Capture durable findings after verification; close planning and implementation
   tickets according to their own acceptance criteria.

## Decision log

- September 23: user requested collaborative process management.
- September 23: agent established that the initial checkout predates the current
  editor and created a separate worktree from current main for this work.
- September 23: user delegated design choices and directed close adherence to
  Lyuba’s feedback. Accepted direction and agent-selected defaults are recorded
  above; routine design approval questions are no longer pending.

## Railway verification — September 23

- Project: `forge` (`98952497-a4d9-4714-8fe8-0cdbff3147c9`).
- Environment: `production` (`5f41e037-90e4-4674-a3ea-66bbd05fb3b4`).
- Service: `@forge/manager` (`2f325a67-7aae-4160-a111-74b9fde40d05`).
- Custom domain: `manager.jesusfilm.org`, port 8080.
- Active deployment: `def3606f-23de-4355-9d2c-57426dee4f79`, `SUCCESS`,
  created September 18 at 22:49:56 UTC. More recent entries are `SKIPPED`;
  current main must not be assumed to be the deployed commit.
- Initial navigation reached Manager sign-in in both browsers. User subsequently
  signed in to Chrome; project inspection and playback then succeeded. No production
  configuration was changed.
- User correction: discover infrastructure facts from connected Railway access
  before asking the user to supply them.

## Playback investigation — September 23

Project: [Pharisee cold open](https://manager.jesusfilm.org/dashboard/shorts/50283581-ced8-42f8-980c-097be7a6c5fc), saved revision 6, 1080×1920, 30 fps, 13 seconds.
Four video items cover 0–3, 3–6, 6–9, and 9–13 seconds. Three text items occupy
a separate visual track. This matches the title, text, and timing in the recording.

- The seven-second recording contains black portrait-preview intervals at recording
  timestamps 3.175–3.642 seconds (0.467s) and 6.175–6.533 seconds (0.358s).
  Text remains visible. These are recording timestamps, not exact timeline frame bounds.
- Measurement: FFmpeg `crop=370:670:1755:150,blackdetect=d=0.04:pix_th=0.05:pic_th=0.92`
  on the original 3412×1478 recording; visual contact-sheet review corroborates it.
- Live Chrome playback, using Play from frame zero and read-only DOM sampling,
  showed readyState 4 and 1920×1080 decoded video before the first cut; at sampled
  playhead frames 96 and 101, the incoming video had readyState 0 and 0×0 dimensions.
  At frames 106–109 it had metadata (readyState 1), not a playable frame.
  Timing samples are non-atomic, so avoid attributing an exact cut boundary to them.
- This supports the reported preview failure; it does not establish root cause or
  constitute an automated pixel assertion against the live player. Build that loop
  before changing playback behavior. Track under feat-535.
- After this playback run, the editor displayed “Something went wrong” with
  React error #185. Console stack included `f.set`, `f.seek`, and a player callback.
  Observed once; frequency, trigger, and relationship to the flashes remain unknown.
  Track independently under feat-536. No cause is inferred from the stack alone.
- “Try again” recovered the editor to frame zero, still Saved · r6. No project edits,
  saves, renders, or publication were performed.
- Local scratch evidence: `/tmp/forge-studio-evidence/recording-first.jpg` and
  `/tmp/forge-studio-evidence/contact.jpg`. These are not repository artifacts.

Follow-up tickets: feat-535 (cut continuity), feat-536 (playback crash).

## Delivered behavior

Video / Audio / Text groups preserve stored layering and expose overlap rows. The vertical playhead supports pointer and keyboard seeking; only play/pause remains below the preview. Text offers vendored fonts, shadow, stroke, local scrim, and frame-based entrance/exit motion. Adjacent clips offer bounded crossfade or fade through black without moving authored timing. Preview preloads nearby clips, gates unready HLS, and separates observed playback frames from seek commands.

Local validation and two-axis review are recorded in `docs/validation/studio-feedback/results.md`. Production remains unchanged; the normal PR-to-main deployment flow applies.
