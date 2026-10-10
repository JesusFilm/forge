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

## What the first YouTube runs settled (2026-10-02)

The owner's confirmed YouTube flow (Martha long form, five Prodigal Shorts)
lives in the agent memory `youtube-publishing-checklist`. The points a new
session must not miss:

- Video files are 15 to 600 MB; the Chrome extension uploads at most 10 MB, so
  the agent opens the Upload dialog and reveals the file in Finder, and the
  owner drags it in (several Shorts can go in one drag; they land as Drafts).
- Long form: set the **Title and thumbnail** A/B test _before_ pasting the
  description. Card at 0:00 to the channel, end screen imported from the latest
  video, playlist Daily Devotionals, not for kids, AI question "No" (synthetic
  voices and music are disclosed in the description), Public.
- Shorts: `#Shorts` first in the hashtag line, then set **Related video** to
  the story's long form.
- After the first run the owner asked the agent to publish without a final
  "yes" each time; it still reports every link afterwards.

## Meta (Instagram + Facebook), added 2026-10-02

Same method as YouTube: the owner's Chrome, Claude in Chrome tools, Meta
Business Suite at `business.facebook.com`. Long horizontal videos are not
posted to Meta; it gets the vertical teaser, the Shorts, later a carousel.

Rules on top of the ones above:

- Sign-in, passwords, 2FA and any "not a robot" check are the owner's. Never
  accept new terms, never change Page, Instagram or account settings.
- Files over 10 MB: the owner drags them into the composer, as on YouTube.

Check once before the first post:

1. The owner is signed in to Business Suite.
2. The Instagram account is professional (Business or Creator) and connected to
   the Facebook Page in Business Suite (both appear as posting destinations).

Reel, step by step (ask on the first run where marked):

1. Business Suite → Create reel. Destinations: Instagram, Facebook or both
   (**ask**).
2. Upload the vertical `.mp4` (owner drags it in).
3. Caption: from the `daily-bible-pause-captions` skill. Instagram is the
   default; Facebook gets the same voice with 0 to 3 hashtags and a plainer
   call to action ("Follow the page for more"). If Business Suite allows a
   different caption per platform, use both; otherwise **ask** which one.
   No em or en dashes in captions. Credits block under the caption.
4. Cover: frame from the video or an uploaded image (**ask**).
5. AI label ("Made with AI" / AI info toggle): voices and music are synthetic
   (**ask** how she answers; record it).
6. Collaborators, location, audience, Facebook share-to-feed: **ask** once.
7. Timing: publish now, schedule, or save as draft (**ask**; first run is a
   draft or a schedule so she can look).
8. **Stop. Summarise** (destinations, caption, cover, AI label, time). Wait
   for her "yes", press Publish or Schedule.
9. Write the post links into the story's `README.txt`, and the confirmed
   choices into the memory checklist (Meta section).

## Content calendar (added 2026-10-09, single writer since 2026-10-10)

After every publish or schedule, send the "Calendar" session (local_32447311-7285-4bcd-9696-e4a683c4d597, Analytics group) a short message
(story, kind/cut, platforms, status, date/time, title, links, file path); it updates
https://claude.ai/artifact/86K6PKnMHbezT87VTdbt9J. Do not write calendar rows yourself.
See `docs/content-calendar/README.md`.
