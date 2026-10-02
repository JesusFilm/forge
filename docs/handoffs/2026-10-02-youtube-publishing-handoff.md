# Handoff: publishing Daily Bible Pause videos to YouTube

Written 2026-10-02 for a fresh session that has none of the devotional
conversation. The owner (Lyuba) wants the agent to publish finished videos to
the Daily Bible Pause YouTube channel for her, through her own Chrome, after a
first run where she shows how she does it.

## How the agent works here

- **Browser: Claude in Chrome** (tools `mcp__claude-in-chrome__*`), the owner's
  real Chrome where she is already signed in to YouTube Studio. Not the
  built-in browser pane: it has no sign-in, and the agent must never sign in,
  type a password or accept new terms for her.
- **Upload the file** with the Chrome extension's file upload tool, from the
  paths below. Do not download anything.
- **The agent never presses the final Publish / Schedule / Save-as-public on
  its own.** Before it, show the owner a summary (title, visibility, schedule
  time, thumbnail, playlist) and wait for an explicit "yes" in chat. That yes
  covers ONE video. Drafts saved as Private are fine without asking.
- Do not change channel settings, branding, monetisation, or default upload
  settings, and do not reply to comments, unless she asks for that exact thing.
- Talk to her in Russian, plainly; files and notes in English.

## What a finished story folder holds

`~/Desktop/Social Media/<Story>/` (Martha, Prodigal, Vineyard, ...):

| File                                             | Use                                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `devo_h_<story>.mp4`                             | the long-form video (16:9) to upload                                                          |
| `covers/cover_A_*.jpg`, `cover_B_*`, `cover_C_*` | three approved thumbnails (JPG, under 2 MB)                                                   |
| `captions_<story>.txt`                           | per-cover titles, the description (with chapters, credits, hashtags), the recommended variant |
| `teaser_*_vertical.mp4`                          | a 9:16 intro teaser (a Short)                                                                 |
| `shorts/*.mp4` + `shorts/shorts.md`              | cut-down Shorts and what each says                                                            |
| `es/`                                            | the Spanish long-form, when there is one                                                      |

Martha and Mary is complete (video, covers, captions). Prodigal has video,
covers, teaser and shorts, but its YouTube copy was given in chat and is NOT
in a file yet: write `captions_prodigal.txt` first with the
`daily-bible-pause-captions` skill (titles "<title> | Luke 15:11–32", one per
cover, never repeating the cover text; credits per
`docs/devotional-credits-template.md`).

## Long-form upload, step by step (to confirm on the first run)

1. YouTube Studio → Create → Upload videos → the `.mp4`.
2. Title: the recommended variant's title from `captions_<story>.txt`.
3. Description: paste the description block as is (chapters must start at 0:00).
4. Thumbnail: if Studio offers **Test & compare**, upload all three covers
   (A, B, C) so YouTube runs the A/B test; otherwise upload the recommended one.
5. Playlist: ask on the first run which one, then remember it.
6. Audience: "No, it's not made for kids" (confirm on the first run).
7. Altered or synthetic content: the narration voices and music are AI. Ask
   the owner on the first run how she answers this question, then record it.
8. More options: language English, category, tags only if she uses them.
9. Video elements: end screen and cards as she shows on the first run.
10. Visibility: Private, Unlisted or Scheduled as she says. **Stop. Summarise.
    Wait for "yes". Then press the button.**
11. After publishing: copy the video URL into the story's `README.txt`.

Shorts (teaser and cut-downs) follow the same flow; the vertical file is
detected as a Short. Their copy comes from the captions skill's Shorts
format (`#Shorts` first), not from the long-form description.

## First run with the owner

She will publish one video together with the agent and say what she picks at
each step. While doing it, write her choices into a checklist and save it as a
memory (`youtube-publishing-checklist`), so later runs follow it without
asking. Start with Martha and Mary: `~/Desktop/Social Media/Martha`.

## Later: the YouTube API instead of the browser

A YouTube Data API upload (OAuth client + refresh token for the channel)
would allow fully automatic, scheduled publishing. It needs Google Cloud
credentials and channel access set up by Vlad, so it is not part of this
first step.
