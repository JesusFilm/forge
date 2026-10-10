# Peace in the Storm narration acceptance

Project: `bdadcc6a-f4d0-4d38-bf6c-70f079cc34dd`.

On 2026-09-12, the operator imported Bella (`hpp4J3VqNfWAUOO0d1Us`), saved
and approved all six narration passages in revision 10, and explicitly accepted
ElevenLabs charges without an exact price estimate. Production run
`cmty79q5i558es00sw7225yze` retained six successful recordings, reporting 149
provider credits in total. Currency cost was unavailable.

Automatic attachment initially failed; feat-491 records the defect and subsequent repair. One resume
reused retained results without new paid calls. The operator placed the existing
assets through the editor library, verified their SHA-256 hashes against the
retained call results, and saved revision 12.

| Segment | Start | Decoded speech duration | Audio SHA-256                                                      |
| ------- | ----- | ----------------------- | ------------------------------------------------------------------ |
| 1       | 0s    | 5.666s                  | `6645fbf11351ba5607da22b3dc2770b992a675a508a49ffe354457baecced791` |
| 2       | 10s   | 6.130s                  | `3d94b5f04185749e952740817c3309d8c9ba4b562bcc249da95629279896c91b` |
| 3       | 20s   | 6.316s                  | `107b379b08ab4f6194127efb071a760e89272eb6e17ba3232172aeba2979d830` |
| 4       | 30s   | 5.201s                  | `91c4cdc0b16e2cbd0d587127b37204660180f808b112bc3e95dfc41a6689c743` |
| 5       | 40s   | 5.712s                  | `8c8ae6d8b750718c3808ac2024f4e8ff3028b59d2c1fae05fbf8d9ec19543899` |
| 6       | 50s   | 5.108s                  | `c36c2b03212bfd07300045281d89e132734c51e2d6bfb4ab3aa232f52ba955c3` |

Every card and narration slot lasts 300 frames at 30fps. Narration volume is 1;
background music remains 0.18 for all 1,800 frames. Source footage remains at
volume 0.08. Audio links identify the corresponding original card UUIDs.

## Operator verification

Timeline clips overlap the music track, so pointer selection can select a
neighbor. Focus each timeline button and press Enter before changing its inspector.
Number fields commit on blur or Enter. Reselect each item after editing and verify
its saved values. An intermediate render was cancelled after this check caught
incorrect clip selection; the corrected render uses revision 12.

A temporary preview audio-tag error caused by overlapping intermediate clips
cleared after saving corrected timing and reloading. The clean preview sought
successfully to each of the six ten-second boundaries and decoded each expected
recording without errors. No preview implementation change was required.

## Historical local workaround

The revision-12 worker stopped after frame 284 and eventually failed; feat-492
records this separate defect and subsequent repair. Revision 13 replaces the six timeline clips with
one continuous 60-second WAV assembled from those exact retained files at their
original offsets. The original six files and speech definitions remain retained.
No additional provider calls were made. The upload UI classifies the continuous
WAV as music, but its filename identifies it as Bella narration and its volume is 1.

The local export preserves the previously rendered video packets and reconstructs
its audio from the current worker's verified source media, source trim (3 seconds
into the captured 40-second source window), source volume 0.08, verified music
WAV at 0.18 and the continuous narration at 1. It does not reuse the older render's
louder sound mix.

Local validation decoded all 1,800 frames at 1080×1920, 30fps, duration 60 seconds.
All six sampled card images were inspected. Audio correlation matched every
retained passage at exactly 0/10/20/30/40/50 seconds, with coefficients from 0.887
to 0.961. The decoded mono peak was 0.828. The local artifact and detailed
verification are under `/home/tataihono/.cache/forge-devotional/final-review/`;
the video is `/home/tataihono/.cache/forge-devotional/Peace in the Storm - narrated.mp4`.

The revision-13 Studio render passed the first stall point but stalled again
after frame 758. It was cancelled; the worker defect is tracked under feat-492.
At that point only the local narrated MP4 was verified; the normal hosted flow
remained incomplete. The subsequent repair and hosted acceptance are recorded below.

## Normal workflow repair — 2026-09-13

PR #2261 corrected S3 Uint8Array manifest decoding. After Railway deployed main
commit `52272bcc5949bd01f5f2967ac4bf885ebc80aa1e`, the normal Studio UI completed
run `cmtyf5sr1002rs40syyc7czm6` from revision 14, with `calls: []`, zero cost,
SUCCEEDED attempt and no timing conflicts. Canonical attachment created revision 15. Revision 16 restores all six ten-second slots using the original six asset
versions; the consolidated workaround audio was removed. Read-only production
verification confirmed all positions, levels, hashes and 1800-frame duration.

PR #2262 corrected the renderer's separate SIGXFSZ crash by bounding Chromium's
image-parking allocator to 64 MiB. The full retained revision-13 fixture then
rendered and decoded successfully in 794.44 seconds inside the unchanged worker
profile. Output SHA-256 was
`2fd9470f7765411e2df357708d39f30dba07f21dedb5ad9226efe17aab4cf258`.
The published release comes from main commit
`872671a66eeed1beebacaec872896ae02b38626a` and workflow run `34696846418`.
Candidate SHA-256:
`34f6bc3413c8e8f834b2141727fc1f20493004ba8c36f49de351511dd1a55ebb`.

Production acceptance of the restored six-clip revision passed below.

PR #2263 aligned the Manager ownership-check deadline with the worker allowance
(9 seconds inside 10 seconds). A real six-second response fails before the fix
and succeeds afterward; nine-second expiry and caller cancellation still fail
closed. Main commit: `784a6f5eeb030254a77408b7f83ad0ef30f80c45`. The earlier failed
normal revision-16 attempt `cmtyfqjxt01q4s40sm2ggwmqt` remains retained.

## Normal hosted acceptance

Manager deployment `631647ee-e68b-42de-9b50-36f4b2488514` succeeded from main.
The normal **Render saved revision** action admitted revision 16:

- Attempt: `cmtygwngq0522s40s9lv22qdt`, SUCCEEDED.
- Dispatch: `8c95e3c5-e377-41af-9f1d-f8fffad347cb`, render job COMPLETED.
- Mux asset: `inL9kxSDyBhD5U94027ZLMHWRKx5WZ006o263ezabtBY4`, READY.
- Output: 60,844,028 bytes, SHA-256
  `273c7ab6f5493187a4c811030ff76a749e8aded22d71ebdeb911924e35a17911`.

The production output is byte-identical to the released-image six-MP3 VM
qualification. The production verifier accepted it, and an independently captured
copy decoded all 1,800 frames at 1080×1920, 30 fps, 60 seconds. All six card
samples were inspected. Audio correlation matched the six original recordings
at 0/10/20/30/40/50 seconds plus the consistent 42.7 ms AAC offset, with
coefficients 0.887–0.961; mono peak was 0.832. See `verification.json`.
The captured worker monitor recorded zero OOM and PID-limit events; peak
cgroup memory was 2,143,424,512 bytes, below the unchanged 2 GiB bound.

The normal **Review rendered video** action loaded a playable 60.053333-second
video with readyState 4 and no media error. No Watch publication was performed.
No new paid narration calls were made during recovery.

Review project: [Peace in the Storm](https://manager.jesusfilm.org/dashboard/shorts/bdadcc6a-f4d0-4d38-bf6c-70f079cc34dd).
The exact production MP4 and detailed local checks are retained under
`/home/tataihono/.cache/forge-devotional/normal-review/`; the video is
`Peace in the Storm - Studio.mp4`. This completes the narration/render recovery;
it does not claim unrelated feat-458 scope or publication acceptance.
