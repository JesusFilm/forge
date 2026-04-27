# Creative Content Formats for Messaging Bubble Delivery

## JesusFilm Experience — R&D Session 2026-04-24

---

## Summary Matrix

| Format                                    | iMessage            | WhatsApp                | Telegram            | RCS/Google Messages       | Signal | Cold-Fit Score |
| ----------------------------------------- | ------------------- | ----------------------- | ------------------- | ------------------------- | ------ | -------------- |
| MP4 H.264 (≤16 MB)                        | inline autoloop     | inline autoloop         | inline              | inline (UP 2.x+)          | inline | 5/5            |
| MOV HEVC/H.265                            | native              | re-encoded to H.264     | yes                 | device-dependent          | no     | 2/5            |
| Short clip <10s loop                      | yes                 | yes                     | yes                 | yes                       | yes    | 5/5            |
| Cinemagraph (MP4/APNG)                    | yes                 | yes (MP4 path)          | yes                 | yes                       | yes    | 4/5            |
| Side-by-side clip                         | yes                 | yes                     | yes                 | yes                       | yes    | 3/5            |
| Teaser + end-card CTA                     | yes                 | yes                     | yes                 | yes                       | yes    | 5/5            |
| Multi-scene cut + text overlays           | yes                 | yes                     | yes                 | yes                       | yes    | 4/5            |
| Animated GIF                              | yes (converted MP4) | yes (converted MP4)     | yes (converted MP4) | yes                       | yes    | 3/5            |
| APNG                                      | native              | treated as static       | no                  | no                        | yes    | 2/5            |
| Animated WebP                             | iOS 14+             | stickers only           | stickers only       | partial                   | yes    | 2/5            |
| Live Photo (.heic + .mov pair)            | iPhone→iPhone only  | no                      | no                  | no                        | no     | 2/5            |
| Animated AVIF                             | no                  | no                      | no                  | no                        | no     | 1/5            |
| Lottie JSON                               | no                  | no (WA uses internally) | TGS only            | no                        | no     | 1/5            |
| TGS (Telegram animated sticker)           | no                  | no                      | native              | no                        | no     | 2/5            |
| WhatsApp animated sticker (.webp)         | no                  | native                  | no                  | no                        | no     | 2/5            |
| Video sticker WEBM VP9                    | no                  | no                      | native              | no                        | no     | 2/5            |
| Audio message (M4A/Opus)                  | waveform inline     | waveform inline         | yes                 | yes                       | yes    | 3/5            |
| iMessage MSMessage extension              | sender app req'd    | no                      | no                  | no                        | no     | 2/5            |
| Telegram Mini App link                    | no                  | no                      | via bot link        | no                        | no     | 3/5            |
| RCS Rich Card + Carousel                  | no                  | no                      | no                  | UP 2.x+, streaming UP 4.0 | no     | 3/5            |
| WhatsApp Business Interactive             | no                  | Business API only       | no                  | no                        | no     | 1/5            |
| Apple Messages for Business               | business acct       | no                      | no                  | no                        | no     | 1/5            |
| QR in video end-card                      | yes                 | yes                     | yes                 | yes                       | yes    | 4/5            |
| App Clip Code                             | iOS only, camera    | no                      | no                  | no                        | no     | 2/5            |
| Snapcode                                  | no                  | no                      | no                  | no                        | no     | 1/5            |
| AMP for Email                             | Gmail only          | no                      | no                  | no                        | no     | 2/5            |
| HTML Email                                | Gmail/Apple Mail    | no                      | no                  | no                        | no     | 3/5            |
| View-once clip                            | 2 min audio/video   | "view once"             | yes                 | no                        | yes    | 3/5            |
| Vertical audio-visual quote card          | yes                 | yes                     | yes                 | yes                       | yes    | 4/5            |
| 3-item share payload (clip+image+caption) | app-dependent       | partial                 | yes                 | partial                   | yes    | 3/5            |

---

## Format Catalog

### VIDEO-SHAPED FORMATS

---

#### 1. MP4 H.264 (Baseline/Main Profile, 9:16 Vertical)

**Technical Spec**

- Codec: H.264 AVC, Baseline or Main profile (High profile works on most modern clients but reduces compatibility on older Android)
- Container: MP4 (MPEG-4 Part 14), moov atom at front (`faststart`)
- Resolution: 1080×1920 (9:16) preferred; 720×1280 acceptable for <5 MB targets
- Bitrate: 1.5–4 Mbps for 1080p; 800 kbps–1.5 Mbps for 720p
- Audio: AAC-LC stereo 44.1 kHz, 128 kbps (mute-safe: design for silent viewing)
- Max file size for inline delivery: **16 MB** (WhatsApp hard cap for media); iMessage has no documented hard cap but Apple recompresses above ~30 MB; Telegram limit 2 GB
- Max duration for inline use: under 90 seconds at 16 MB / 1.5 Mbps
- For looping clips: encode with `qt_loop` metadata atom or use <10s duration for natural loop

**Authoring**

- FFmpeg (open source): `ffmpeg -i input.mp4 -c:v libx264 -profile:v main -level 4.0 -crf 23 -movflags +faststart -vf "scale=1080:1920" -c:a aac -b:a 128k output.mp4`
- Burned subtitles: `-vf "subtitles=subs.srt:force_style='FontSize=24,PrimaryColour=&HFFFFFF'"`
- Subtitle burn prevents font substitution on recipient device (critical for scripture)

**Platform inline rendering**

- iMessage: autoplays muted, loops, tap for fullscreen with audio
- WhatsApp: inline thumbnail → tap to play with audio; autoloops if <60s
- Telegram: inline streaming, autoplays muted
- RCS (Google Messages): inline on UP 2.x devices
- Signal: inline

**Recipient interaction**
iMessage: tap once to unmute/play fullscreen; loops silently in thread. WhatsApp: tap to play inline with sound. Telegram: autoplays silently inline, tap for sound/fullscreen.

**Cold-recipient conversion potential: 5/5**
Universal format, no install required, works across every platform. Muted autoplay with burned captions is the dominant pattern for cold-audience social content (TikTok/Reels playbook). For JFP: 20–45s teaser with scripture text overlaid + QR end-card pointing to web Experience is the highest-leverage baseline play.

**Bandwidth**
At 1.5 Mbps, 30s = ~5.6 MB. Cellular-friendly. 720p at 800 kbps brings 30s to ~3 MB.

**Accessibility**
Burned-in subtitles: fully accessible (screen reader can't read video text, but captions serve the 69% of users who watch silent). Auto-transcription: iMessage iOS 16+ will attempt auto-transcription on tapped video. Screen readers: video thumbnail labeled with filename unless custom label set.

**Spam/abuse risk**
Low for peer-to-peer shares. WhatsApp Business API will restrict bulk video sends. Human-forwarded video is treated as organic.

---

#### 2. MOV with HEVC/H.265

**Technical Spec**

- Codec: HEVC (H.265), Main or Main 10 profile
- Container: QuickTime MOV
- Bitrate: ~50% of H.264 for equivalent quality (e.g. 750 kbps for 720p)
- Max resolution: 4K supported by codec; messaging-practical: 1080×1920

**Authoring**

- FFmpeg: `ffmpeg -i input.mp4 -c:v libx265 -crf 28 -tag:v hvc1 output.mov`
- The `-tag:v hvc1` tag is required for Apple ecosystem recognition

**Platform inline rendering**

- iMessage: native; iOS 11+ hardware decode
- WhatsApp: re-encodes to H.264 on upload, stripping HEVC; Android broadly does not support HEVC playback inline
- Telegram: yes on supported devices
- RCS: device-dependent

**Conversion potential: 2/5**
HEVC's advantage (smaller file for same quality) is negated by WhatsApp's re-encoding and Android fragmentation. Use H.264 for cross-platform; reserve HEVC for iPhone-to-iPhone sharing of high-quality clips.

---

#### 3. Short Clips <10s (Looping)

**Technical Spec**
Same as MP4 H.264 above. Key distinction: duration under 10s enables seamless loop in iMessage thread without tap. WhatsApp loops clips under 60s. Telegram loops all video.

- For loop continuity: begin and end frames should match; use FFmpeg `-ss` and `-to` to trim a natural loop point.

**Authoring**
FFmpeg with `-loop 1` for still-into-video; `boomerang`-style: encode forward then reverse: `ffmpeg -i clip.mp4 -filter_complex "[0]reverse[r];[0][r]concat=n=2:v=1:a=0" loop.mp4`

**Conversion potential: 5/5**
A 5–8s looping clip of a powerful scene (e.g., Jesus walking, healing, or a crowd moment) with a scripture lower-third autoloops in the thread and is visually impossible to ignore as the conversation scrolls past.

---

#### 4. Cinemagraph (Still Photo + Looping Video Region)

**Technical Spec**
Two delivery paths:

- **MP4 path** (cross-platform): Mask out a moving region, export as looping MP4 with near-static background. ~2–8 MB for 5–10s at 1080p.
- **APNG path** (iMessage/Signal only): Animated PNG, max practical size ~3–5 MB before quality degrades unacceptably for photographic content.

**Authoring**

- Open source: `github.com/yrevar/semi_automated_cinemagraph` (OpenCV + FFmpeg mask-based pipeline)
- Process: shoot on tripod → identify moving region → apply static mask to all frames except region → encode as looping MP4 or APNG
- Production tool: Flixel/Cinemagraph Pro (proprietary, macOS/iOS only) for high quality

**Platform inline rendering**
As MP4: all platforms. As APNG: iMessage and Signal only.

**Recipient interaction**
Autoloops silently. The cinemagraph effect is the entire draw: the recipient perceives a photo that is inexplicably "alive."

**Conversion potential: 4/5**
High creative differentiation. A Jesus-Film cinemagraph — e.g., still of the Sea of Galilee with only the water animated — communicates "this is different from a normal video" without demanding attention. Strong for first-touch contemplative delivery.

**Bandwidth**
MP4 path: 2–8 MB at 5–10s. Cellular-friendly.

---

#### 5. Teaser with End-Card CTA Overlay

**Technical Spec**
Standard MP4 H.264. CTA overlay is burned-in text or graphic in final 5–8s of clip. QR code can be embedded in the end-card frame.

- QR code minimum pixel size for reliable scan in 1080p frame: 150×150px; use high error correction (level H)
- End-card duration for QR scan: minimum 8s on-screen (CTV research shows most scans within first 10s of QR appearance)

**Authoring**
FFmpeg `drawtext` filter for text overlays; `overlay` filter for PNG QR code compositing:

```
ffmpeg -i video.mp4 -i qr.png \
  -filter_complex "[0:v][1:v]overlay=W-w-20:H-h-20:enable='between(t,22,30)'" \
  -c:v libx264 -movflags +faststart output.mp4
```

QR generation: `qrencode` (CLI, open source), `python-qrcode` library.

**Conversion potential: 5/5**
This is the baseline "safe bet" format for JFP. 20–30s teaser of the Jesus Film or a Bible story scene, subtitled, ending with QR code pointing to `jesusfilm.org/experience/[slug]` or an App Store deep link.

**QR scan rates**
Median organic QR scan rate in CTV/video context: ~0.004% of impressions. However, peer-to-peer messaging context is dramatically different — recipient has personal relationship with sender, dramatically improving intent. Expect 5–15% tap/scan rate in warm-forward context.

---

#### 6. Multi-Scene Cut with Text Overlays

**Technical Spec**
MP4 H.264, same spec as baseline. Multiple scenes edited together. Scripture text or quote cards intercut with footage using burned-in typography.

**Authoring**
FFmpeg concat demuxer for stitching clips; `drawtext` for title cards.

**Conversion potential: 4/5**
Modeled on Instagram Reels / TikTok "scripture quote + footage" format. A 30s cut interleaving a Jesus Film scene with scripture text overlays (e.g., John 3:16 card → healing scene → John 3:16 callback) creates narrative rhythm that prompts replay.

---

### ANIMATED / IMAGE FORMATS

---

#### 7. Animated GIF

**Technical Spec**

- Container: GIF87a or GIF89a
- Color depth: 256 colors max (8-bit palette per frame — major quality limitation for photographic content)
- Resolution: max practical 480×854 (9:16) at reasonable file size
- File size: practical limit 5–8 MB before recipient frustration
- Duration: no hard limit, but >10s GIFs above 3 MB cause friction
- Frame rate: 10–15 fps typical; 25 fps possible but file size balloons

**Authoring**
FFmpeg: `ffmpeg -i input.mp4 -vf "fps=12,scale=320:-1:flags=lanczos,palettegen" palette.png && ffmpeg -i input.mp4 -i palette.png -vf "fps=12,scale=320:-1:flags=lanczos,paletteuse" output.gif`
Dithering is critical for photographic content to minimize banding.

**Platform rendering**

- ALL major platforms accept GIF
- iMessage, WhatsApp, Telegram: convert GIF to MP4 on-the-fly server-side. The recipient sees it rendered as an MP4 loop — this is transparent to the sender but means the 256-color limitation is bypassed in the rendered output.
- Direct GIF: rendered as-is on email clients, Discord, Slack, some web previews

**Conversion potential: 3/5**
GIF's 256-color palette makes photographic scripture imagery look poor as raw GIF. But since all major messaging apps transcode to MP4 for delivery, the actual recipient experience is fine — the raw GIF format is just an authoring/transmission artifact. For scripture quote cards with flat design and limited color, raw GIF quality is acceptable.

---

#### 8. APNG (Animated PNG)

**Technical Spec**

- Full 24-bit + alpha channel color (no palette limitation)
- Format: PNG chunks with `acTL`, `fcTL`, `fdAT` animation control chunks
- Max file size: practical ~5 MB for messaging (10 MB is the Signal limit for sticker packs)
- Duration: no hard limit; practical <10s for messaging
- Used by: iMessage sticker system natively; Signal sticker packs

**Authoring**
`apngasm` (open source CLI): `apngasm output.png frame*.png 1 10` (1/10s per frame)
FFmpeg: `ffmpeg -i input.mp4 -vf "scale=512:512" -plays 0 output.apng`

**Platform rendering**

- iMessage: native — this is the official iMessage sticker format
- Signal: native
- WhatsApp: receives as static PNG (first frame only)
- Telegram: receives as static PNG
- Web/email: Chrome/Firefox/Safari render animated APNG; Outlook renders first frame only

**Conversion potential: 2/5**
iMessage-only for animated rendering. Limited cross-platform reach. Good as a platform-specific play for an iMessage sticker pack (see Creative Plays section).

---

#### 9. Animated WebP

**Technical Spec**

- Compression: VP8/VP8L for animation chunks; superior to GIF in color depth and compression
- Alpha: full alpha channel support
- File size: 30–40% smaller than equivalent GIF
- Max canvas: 16383×16383; practical messaging: 512×512 for stickers
- WhatsApp animated sticker spec: 512×512, ≤500 KB, ≤10s duration, 8ms minimum frame duration

**Authoring**
FFmpeg: `ffmpeg -i input.mp4 -vf "scale=512:512,fps=15" -loop 0 -quality 80 output.webp`
`gif2webp` tool from libwebp: `gif2webp input.gif -o output.webp`

**Platform rendering**

- WhatsApp: for sticker format (512×512 with transparent background); NOT for general inline video
- Telegram: for stickers
- iMessage: iOS 14+ renders animated WebP in UIImageView but iMessage sticker system uses APNG
- General: animated WebP is NOT a cross-platform "safe" format for inline video delivery — only works reliably in the sticker ecosystem

**Conversion potential: 2/5**
Only useful as the delivery container for WhatsApp sticker packs. Not a substitute for MP4 for video content.

---

#### 10. Live Photo (iOS .heic + paired .mov) — DEEP DIVE

**Technical Spec**
A Live Photo is **two files tied by a shared UUID**:

- Still: HEIC (or JPEG) with maker-Apple metadata dictionary key `"17"` containing the UUID string
- Video: QuickTime MOV with:
  - Top-level metadata: `com.apple.quicktime.content.identifier` = UUID (same UUID)
  - Timed metadata track: `com.apple.quicktime.still-image-time` = `0xFF` (marks the still frame position in timeline)
  - Video codec: AVC or HEVC; 960×720 historically, now 1080p HEVC on modern iPhones
  - Duration: ~3s (1.5s before + 1.5s after still)
  - No audio in the MOV portion

**Authoring — Programmatic Generation**

This is the critical non-obvious path. Three routes:

**Route A — macOS-only CLI tool** (`github.com/RhetTbull/makelive`):

- `makelive image.heic video.mov` — writes the UUID content identifier to both files using CoreGraphics + AVFoundation
- Limitations: macOS 10.15+ only; re-encodes at max quality (slightly increases file size); does not preserve XMP in MOV
- Cannot run server-side unless you have a macOS build server

**Route B — iOS native** (PHAssetCreationRequest):

```swift
let request = PHAssetCreationRequest.forAsset()
request.addResource(with: .photo, data: heicData, options: nil)
let opts = PHAssetResourceCreationOptions()
opts.shouldMoveFile = true
request.addResource(with: .pairedVideo, fileURL: movURL, options: opts)
```

This requires PHPhotoLibrary authorization and runs on-device. A JFP iOS app could generate a Live Photo on-device and write it to the photo library, from which the user shares it via native share sheet.

**Route C — Manual metadata injection** (cross-platform, complex):
Write UUID into HEIC EXIF maker-apple dict at key `17` using libheif or PIL/Pillow; write UUID into MOV QuickTime metadata atom using `go-mp4` or PyAV + AVFoundation. No fully open-source pure-Python/Node solution for this exists as of April 2026 — the timed metadata track writing for Live Photo is underdocumented.

**Platform rendering**

- iMessage: renders as Live Photo if shared from Photos via share sheet as Live Photo. Recipient with 3D Touch/haptic or long-press sees the motion. Displays as still in thread; hold-to-animate.
- WhatsApp: strips Live Photo metadata; delivers only the HEIC still
- Telegram: same
- Android: Google Motion Photos is a separate (incompatible) standard

**Recipient interaction**
Long-press or 3D Touch on the still in iMessage thread → plays the 3s MOV loop. Requires iOS recipient on compatible device. Sender must share explicitly as "Live Photo" from share sheet (not "Photo" — the latter strips the video component).

**Cold-recipient conversion potential: 2/5**
iPhone-to-iPhone only. No cross-platform value. However: for an iOS-first JFP app, generating a cinemagraph-style Live Photo on-device (3s loop of a powerful moment) that users can share from their camera roll is a **premium first-touch for iOS users**. The "photo that's alive" moment is genuinely surprising.

**Bandwidth**
HEIC still: 2–4 MB; MOV companion: 4–8 MB. Total ~6–12 MB. Higher than MP4 alternative.

---

#### 11. Animated AVIF

**Technical Spec**

- Codec: AV1 (video) + AVIF container (ISOBMFF-based)
- Supports: full color depth, HDR, alpha, animation sequences
- Compression: 30–50% smaller than animated WebP for equivalent quality
- Browser support (2025): Chrome 85+, Firefox 113+, Safari 16+ — but **messaging app support is near-zero**

**Platform rendering**
No major messaging app (iMessage, WhatsApp, Telegram, Signal, Google Messages) renders animated AVIF inline as of April 2026. Discord added static AVIF support in 2025 but not animated.

**Conversion potential: 1/5**
Not viable for messaging delivery in 2026. Monitor for 2027+.

---

#### 12. Lottie / Rive Animations

**Technical Spec**

- Lottie: JSON-based vector animation, rendered by `lottie-ios`, `lottie-android`, or `lottie-web`. Files typically 5–200 KB.
- Rive: Binary `.riv` format, real-time state machine, rendered by Rive runtime. Files typically 10–500 KB.

**Platform rendering**

- Neither Lottie JSON nor Rive `.riv` files render inline in any messaging app bubble as of 2026.
- **Exception**: Telegram's TGS format is Lottie JSON + gzip compression — Telegram's own client renders TGS natively (see section 13).
- WhatsApp is testing Lottie-based animated emojis internally but has not opened third-party Lottie sticker creation (as of early 2026).
- Use case for JFP: Lottie/Rive are authoring tools for creating TGS stickers or for in-app UI animation in the Expo app. Not a direct messaging format.

**Conversion potential: 1/5**
Not a messaging delivery format; useful as an authoring step toward TGS.

---

#### 13. Animated Sticker Packs (Platform-Specific)

**A. iMessage Sticker Packs (APNG)**

- Spec: APNG, 300×300 or 618×618 px, max 500 KB per sticker
- Distribution: App Store (MessagesApplication extension). Recipient must download the sticker app from the App Store to place stickers; however, receiving and viewing stickers sent by others works without the app.
- Authoring: Xcode MessagesExtension template; export APNG frames
- Cold-recipient flow: sender with app installed places sticker → recipient sees it as inline APNG animation in the thread (no install needed to receive/view). They can tap it to "peel and place" if they also install the app.

**B. WhatsApp Animated Stickers (WebP)**

- Spec: 512×512 px, max 500 KB, max 10s, 8ms minimum frame duration, looped, no audio, transparent background supported
- Authoring: WhatsApp official sticker creation app; `ffmpeg` → animated WebP via `gif2webp` or FFmpeg `-vf format=rgba`
- Distribution: Third-party sticker apps listed in WhatsApp (e.g., Sticker.ly); or direct WebP share from apps that integrate the WhatsApp Sticker API
- Cold-recipient: Any WhatsApp user receives and views animated stickers. Pack install requires recipient to tap "Add" in-conversation.
- First-frame rule: animation loops back to first frame when idle — first frame must be the "hero" pose (e.g., completed scripture text)

**C. Telegram Animated Stickers (TGS)**

- Spec: 512×512 px, max 64 KB (gzipped Lottie JSON), 3s max, 60 fps, looped
- Video stickers (WEBM): 512×512, VP9 codec, max 256 KB, 3s max, 30 fps, no audio, looped
- Authoring: After Effects + Bodymovin-TG plugin (primary); Synfig Studio (open source alternative); LottieFiles → TGS export; `tgs` Python library (`pip install tgs`)
- Distribution: Telegram bot or @Stickers bot for pack creation; shareable via sticker set link
- Cold-recipient: Any Telegram user can receive and view TGS stickers. Pack install in one tap.

**D. LINE Stickers**

- Spec: PNG static or APNG animated, 370×320 px, max 1 MB per sticker, 8-frame APNG for animation
- Distribution: LINE Creators Market
- Relevance for JFP: LINE is dominant in Thailand, Japan, Taiwan. For JFP's international mission context, LINE sticker packs are worth noting if those markets are targeted.

**Sticker conversion potential summary: 2–3/5**
Stickers are **first-touch brand awareness** plays, not conversion drivers. A Jesus Film sticker pack (animated scenes, scripture quotes) creates ambient presence in users' sticker keyboards. Conversion path: sticker → user curiosity → searches the app → installs. Weak funnel but zero-friction distribution once packs are created.

---

### AUDIO FORMATS

---

#### 14. Audio Message (M4A / AAC-LC / Opus)

**Technical Spec**

- iMessage: M4A (AAC-LC), max 2 minutes, renders with waveform visualization + play/pause control; expires after 2 minutes of play OR at user-set auto-expire (2 min or never in Settings → Messages)
- WhatsApp: Opus in Ogg container for voice notes; AAC for shared audio files; voice notes render with waveform, playback speed control (0.5×/1×/1.5×/2×), iOS 16+ auto-transcription
- Telegram: Opus (voice) or AAC (audio file); voice notes render with waveform
- Signal: Opus for voice notes; AAC for shared audio

**Authoring**
FFmpeg: `ffmpeg -i input.wav -c:a aac -b:a 64k output.m4a` (iMessage voice note)
`ffmpeg -i input.wav -c:a libopus -b:a 32k output.ogg` (WhatsApp/Telegram)

**Conversion potential: 3/5**
Audio message is an unconventional touch for JFP. A 60-second narrated Bible passage or a brief spoken-word prayer, delivered as a voice note, occupies a different register than video — more intimate, more contemplative. In cultures where audio messaging is dominant (India, Brazil, parts of Africa via WhatsApp), this could outperform video for initial engagement.

WhatsApp auto-transcription (iOS 16+) means spoken scripture becomes searchable text in the conversation — an unexpected accessibility win.

**Bandwidth**
60s AAC at 64 kbps: ~500 KB. Extremely cellular-friendly.

**Note on "Voice note with cover art"**
No platform natively associates a cover image with a voice note in the same bubble. You can send an image followed by an audio message as two separate bubbles — this creates a "cover art + voice note" pair visually in the thread.

---

### INTERACTIVE / PLATFORM-GATED FORMATS

---

#### 15. iMessage MSMessage Extension (Custom Bubbles)

**Technical Spec**

- Framework: Messages.framework, MSMessageTemplateLayout or MSMessageLiveLayout
- `MSMessageTemplateLayout`: static image + caption/subcaption/trailing caption/trailing subcaption + optional URL; fits in a standard message bubble
- `MSMessageLiveLayout`: renders a live view (UIView subclass) in the bubble — supports interactive content like a live game state
- Message URL: `MSMessage.url` — the data payload. Must be http/https for cross-platform fallback.

**Cold-recipient fallback — CRITICAL DETAIL**
This is what "install required" actually means:

- **Sender** must have the Messages extension installed (bundled in your iOS app) to compose an MSMessage
- **Recipient on iOS 10+ WITH the app installed**: sees the full interactive bubble (MSMessageLiveLayout or the template); can interact with it
- **Recipient on iOS 10+ WITHOUT the app installed**: sees `MSMessageTemplateLayout` — the static image + caption layout — regardless. They CANNOT interact; they see a static bubble showing the template image and captions. Tapping shows a prompt to install the extension app. The `url` property is NOT surfaced as a tappable link in this fallback state.
- **Recipient on macOS**: the `MSMessage.url` opens in Safari when the user clicks on it
- **Recipient on Android / SMS**: receives only the fallback text (`summaryText` property of the MSMessage) — a plain text string

The implication for JFP cold recipients: they see a **static image bubble** (your template layout image), a caption, and a subcaption. They can tap it to get a "get the app" prompt. The URL is NOT a tap-through. This is a significant limitation — the bubble is visually differentiated but NOT interactive without the app.

**Authoring**
Xcode MessagesExtension template. The template image is typically a rendered UIView snapshot that previews the content. For a JFP Jesus Film experience: render a scripture quote card or video thumbnail with a branded frame as the template image.

**Conversion potential: 2/5**
For cold recipients: static bubble with install prompt. Only viable if JFP has an iOS app with a Messages extension AND the goal is to drive app installs from existing users sharing to cold contacts. The static template image still functions as a visual hook.

---

#### 16. Telegram Mini App (Web App via Bot Link)

**Technical Spec — DEEP DIVE**

Architecture: A Telegram Mini App is a web app (HTML/CSS/JS or any web framework) hosted on your server, opened inside Telegram's built-in browser frame. It is always bot-mediated.

**Launch mechanisms:**

- Inline keyboard button (`web_app` type) in a message sent by the bot
- Bot menu button (replaces the text input "attach" button)
- Direct link: `https://t.me/BotUsername/AppName?startapp=param` — opens the Mini App in the current chat context
- Attachment menu entry (user taps "+" attach icon in any chat)

**User-to-user sharing — the honest picture:**
A user CANNOT directly "send" a Mini App to a friend the way they send an MP4. The sharing mechanisms are:

1. User copies the direct link (`t.me/BotUsername/AppName`) and pastes it into a chat → recipient taps the link → bot interaction initiates → Mini App opens
2. The Mini App calls `shareMessage()` to share a `PreparedInlineMessage` (a pre-constructed inline query result) — this lets the Mini App create a shareable message on behalf of the user
3. Inline mode: user types `@BotUsername` in any chat → selects a result → sends an inline result that can include a "Launch" button

**What a cold (bot-never-interacted) recipient sees:**
When a cold recipient taps `t.me/BotUsername/AppName`, Telegram shows the bot's profile with a "Start" button. Tapping "Start" initiates the bot interaction, then the Mini App opens. This is **one extra tap** vs a direct link — not a deal-breaker, but it's not frictionless.

**For JFP:**
A Telegram Mini App could render the full SDUI Experience (hero video, Bible quote cards, quiz buttons, video carousels) inside Telegram's built-in browser, using the existing Next.js web Experience as the hosted URL. The Telegram Web App SDK provides `initData` (user info, theme) and `HapticFeedback` (haptic for quiz answers). The JFP Experience URL becomes the Mini App URL.

**Authoring**
Host the existing `apps/web` Next.js Experience as a Telegram Mini App:

- Register a bot with @BotFather
- Use `setMenuButton` or create an inline button pointing to `web_app: {url: "https://jesusfilm.org/experience/slug"}`
- Add `<script src="https://telegram.org/js/telegram-web-app.js">` to the page; call `WebApp.ready()` and `WebApp.expand()` on load
- This is a **low-code** integration if the web Experience already exists

**Platform rendering**
Telegram only (950M+ users, strong in Eastern Europe, Middle East, South Asia, Southeast Asia).

**Conversion potential: 3/5**
High ceiling for the Telegram-specific audience segment. A shared link to the full interactive Experience (not just a video clip) is the most ambitious cross-platform format, but it's one-platform. The experience quality is maximal — this IS the full SDUI Experience inside the message app.

**Bandwidth**
Depends on the web Experience. Initial load: 200–400 KB HTML/JS; video streams separately.

---

#### 17. RCS Rich Cards and Carousels

**Technical Spec**
RCS Business Messaging (RBM) rich card spec:

- Images: JPEG/PNG, 3 height options (112/168/264 DP), aspect ratios 2:1, 16:9, or 7:3 for vertical cards
- Video: H.263, M4V, MP4, MPEG-4, WebM supported; 250 KB total payload limit (video served from URL, not embedded)
- Text: title max 200 chars, description max 2,000 chars
- Buttons: up to 4 suggested replies/actions per card; up to 11 chip suggestions below card
- Carousel: up to 10 vertical cards, small (180 DP) or medium (296 DP) width

**RCS Universal Profile 4.0 (finalized March 2026):**
Streaming video in Rich Cards now part of the spec — embedded streaming video vs download-first. Rich text (bold, italic, strikethrough). Implementation timeline: carrier-dependent; Google Messages likely first adopter in H2 2026.

**Who can send RCS Rich Cards**
**Critical limitation for JFP**: RCS Rich Cards are a **business messaging feature** (RCS Business Messaging API). They require registering as an RCS Business agent with a carrier/aggregator (Sinch, Twilio, etc.). A peer-to-peer user cannot send rich cards — they can only send regular media (images, video files). For JFP as an organization with a registered business number, RCS rich cards are viable.

**Platform rendering**
Google Messages on Android (dominant): renders rich cards inline. iOS: via Apple's RCS support (iOS 18+ with carrier RCS enabled) but Apple renders rich cards in basic mode — full carousel support on iOS is not confirmed for all cards.

**Conversion potential: 3/5**
Strong for Android-first markets (Latin America, Africa, South Asia). Carousel of 5 Jesus Film clips with action buttons ("Watch More," "Read the Story," "Download App") is the ideal JFP format here. Requires business account setup.

---

#### 18. WhatsApp Business Interactive Messages

**What a personal account can send**
A regular WhatsApp personal account can send: images, video, audio, stickers, documents, locations, contacts. It CANNOT send list messages, button messages, CTA URL buttons, or product messages — these are exclusive to the WhatsApp Business API.

**What WhatsApp Business API provides**

- List messages: menu of up to 10 options (e.g., "Watch Jesus Film" / "Read John 3:16" / "Find a Church")
- Button messages: up to 3 quick-reply buttons
- CTA URL button: single button with URL (opens `jesusfilm.org/experience/...`)
- Template messages: pre-approved structured messages with header image/video + body + footer + buttons

**Prerequisites**
WhatsApp Business API account via Meta or a BSP (Twilio, MessageBird, etc.); phone number registered to the business; template approval by Meta for proactive outreach (24h window for responses; session messages for inbound-initiated).

**Conversion potential: 1/5 for P2P use case**
WhatsApp Business interactive messages cannot be used by individual missionaries sharing content peer-to-peer. Only viable if JFP runs a WhatsApp Business channel (e.g., subscribers opt-in to receive devotional content). Different use case than the cold-recipient gateway scenario.

---

#### 19. Apple Messages for Business

**Prerequisites**
Requires: business registration with Apple, an Apple-approved Messaging Service Provider (MSP), a registered business phone number, and brand approval. Not available for peer-to-peer use by individuals.

**Capabilities**
List Picker, Time Picker, Apple Pay, Authentication, Rich Links. Can send images and videos with action buttons. Initiated only when user explicitly messages the business (via "Message" button on Apple Maps, Safari, Siri, or App Clips).

**Conversion potential: 1/5**
Business account prerequisite means this is a customer service / opt-in channel, not a cold-contact gateway. Not relevant for the JFP missionary-to-stranger scenario.

---

### CODES AND SCANNABLES

---

#### 20. QR Codes Embedded in Video / Stills

**Technical Spec**

- QR code minimum module size in video: 4×4 pixels per module for reliable scan at 1080p
- Recommended size for end-card: 200×200 px minimum in a 1080×1920 frame
- Error correction: Level H (30% data recovery) for video context where compression artifacts occur
- Tools: `qrencode` (CLI), `python-qrcode`, `zxing` Java library, Canva/Adobe Illustrator for design integration
- Static QR: links to a fixed URL; Dynamic QR: links to a redirect URL that can be changed post-production

**Cold-recipient scan behavior**
iOS 14+: native QR scan from camera app without third-party scanner. Android: Google Lens and built-in camera on most modern devices. Recipient holds phone up to screen/image to scan.

**Conversion potential: 4/5**
QR codes in end-cards bridge the gap from passive viewing to active engagement. For JFP: encode `jesusfilm.org/experience/[slug]` with UTM parameters for tracking. Dynamic QR (via Bitly, Uniqode, etc.) allows A/B testing destination without re-producing video.

---

#### 21. App Clip Codes

**Technical Spec**
Visual code that launches an App Clip (a lightweight sub-experience of a full iOS app, ≤50 MB, no install required). Two types:

- Scan-only (QR-style, camera scan)
- NFC+Scan (embedded NFC tag + visual pattern)
  Generated via App Store Connect or `AppClipCodeGenerator` command-line tool; downloads as SVG.

**Prerequisite**
JFP must have an iOS App Clip registered and approved in App Store Connect. The App Clip URL must be configured in Xcode and App Store Connect.

**Cold-recipient flow**
Recipient scans the App Clip Code → iOS shows the App Clip card (3-second animation) → taps "Open" → App Clip launches (no full app install required) → after using, iOS prompts to install the full app.

**Conversion potential: 2/5**
Strong mechanism but iPhone-only, requires App Clip development, and the code in a video end-card requires the recipient to physically scan a screen with their camera — friction in a messaging context. Better for printed materials, physical locations, or QR code images than for embedded video.

---

### EMAIL-ADJACENT FORMATS

---

#### 22. HTML Email (Rich Content)

**Technical Spec**

- Supported: Gmail, Apple Mail, Yahoo Mail, Outlook (with limitations)
- Inline video: HTML `<video>` tag NOT supported in Gmail or Outlook; fallback to animated GIF or static image
- Animated GIF: works in Gmail, Apple Mail; renders first frame only in Outlook
- Max width: 600px is standard safe width
- Interactive CSS: Gmail supports some CSS animations (keyframes); Outlook renders none

**Conversion potential: 3/5**
Email is not "messaging" in the JFP cold-recipient sense, but it is a valid channel for warm contacts. An HTML email with a video thumbnail (static image) that links to the web Experience, plus an animated GIF of a 3-frame scripture quote, is the practical achievable format.

---

#### 23. AMP for Email (Gmail Only)

**Technical Spec**

- Supported email clients: Gmail (web, Android, iOS), Yahoo Mail, Mail.ru
- NOT supported: Apple Mail, Outlook — they receive the HTML fallback
- Interactive components: `amp-carousel` (swipeable image carousel), `amp-form` (inline form submission), `amp-list` (dynamic content from API), `amp-accordion`, `amp-bind` (state management)
- Content freshness: AMP emails can fetch live data at open time (e.g., current verse of the day)

**JFP use case**
An AMP email containing an `amp-carousel` of 5 Jesus Film scene images with scripture overlays, plus an inline "Prayer Request" form that submits without leaving the email. At open time, `amp-list` fetches the current Bible verse of the day from a JFP API.

**Conversion potential: 2/5**
Gmail-only for interactivity (Gmail has ~35% global email client share). Requires AMP sender registration with Google. Valuable for a devotional email series, not for cold-contact first touch via messaging.

---

### HYBRID / UNCONVENTIONAL FORMATS

---

#### 24. Silent-Captioned Vertical Video (TikTok/Reels Pattern)

**Technical Spec**
Standard MP4 H.264 9:16 vertical, but with:

- Burned-in large-typography captions (min 28pt equivalent at 1080p)
- Captions timed to narration/audio ("word-pop" style or sentence-level)
- Captions positioned in lower third with high contrast background (solid black bar or drop shadow)
- Design principle: EVERY WORD visible on mute; audio is enhancement, not requirement

**Authoring**

- Transcription: Whisper AI (open source, `openai/whisper`) → .srt or .ass file
- Caption styling: FFmpeg `subtitles` filter with custom ASS styles; or DaVinci Resolve's `Fusion` text for animated word-pop
- Tools: CapCut (proprietary but fast for prototyping), Premiere Pro, DaVinci Resolve (free tier sufficient)

**Conversion potential: 4/5**
The dominant pattern for cold-audience video on every social platform in 2024–2026. An 85% mute-watch rate means the caption IS the content. For JFP: narrated scripture + scene footage with every line burned in large text → the message is received regardless of audio context (commuter, shared space, silent phone).

---

#### 25. "Part 1/5" Chain-Style Content

**Technical Spec**
A series of short MP4 clips (each 20–40s) numbered and structured to create continuation pressure. Each clip ends with "→ Part 2: [hook]" as a burned-in CTA. Delivered as sequential messages in a thread.

**Authoring**
Same as baseline MP4. The "chain" is a content strategy, not a format.

**Conversion potential: 3/5**
Creates a multi-session engagement pattern. Works in Telegram (channel-style broadcast) or as a multi-message send. Risk: recipients may mute the thread after clip 1 if clip 1 doesn't earn forward momentum. Strong for friends of users who are already engaged (warm-forward context).

---

#### 26. Ephemeral "View Once" Clips

**Technical Spec**

- WhatsApp: "View Once" — photo or video, opened only once, then disappears from the thread. No forwarding, screenshot notification shown (cannot technically block screenshot but is visible).
- Instagram: DM disappearing photos/videos
- Snapchat: native disappearing model
- iMessage: 2-minute auto-expiry for audio/video messages (Settings → Messages → Audio Messages → Expire → After 2 Minutes)

**Cold-recipient flow**
Sender sends a View Once video → recipient sees "Tap to open" bubble → recipient opens it once, watches, it disappears. No second chance, no forwarding.

**Conversion potential: 3/5**
The scarcity/curiosity mechanic is real. A JFP use case: "A personal message for you" view-once clip showing a brief, direct spoken invitation to the Experience. The ephemerality creates an intimate, one-time moment. Works best as a warm-contact play, not truly cold. Measurement: sender cannot know if recipient watched.

---

#### 27. Vertical Audio-Visual Quote Cards (Scripture + Image + Voice)

**Technical Spec**
A hybrid format: a 9:16 image (scripture text on photographic background) with an embedded audio layer — delivered as either:

- **Static image** + **separate audio message** (2 consecutive bubbles): image sets visual context; audio narrates/prays the scripture
- **Video** with burned-in text + audio narration + subtle background movement (cinemagraph style): one file, cross-platform

**Authoring**
FFmpeg to composite still + audio into video:

```
ffmpeg -loop 1 -i scripture_card.jpg -i narration.m4a \
  -c:v libx264 -tune stillimage -c:a aac -shortest output.mp4
```

This creates a "slideshow video" — a still image as a video with audio — that plays as a video bubble in all messaging apps.

**Conversion potential: 4/5**
This format hits a register that pure video doesn't: contemplative, personal, intimate. A narrated John 3:16 card with ambient background audio (flowing water, gentle music) sent as a one-minute "video" is a legitimate spiritual content format with no equivalent in mainstream social media. Left-field in the best sense.

---

#### 28. 3-Item Share Payload (Clip + Image + Caption)

**Technical Spec**
iOS share sheet supports sending multiple files of different types to messaging apps. Tested behavior:

| App      | Text + Video                | Image + Video       | Text + Image + Video         |
| -------- | --------------------------- | ------------------- | ---------------------------- |
| iMessage | renders as separate bubbles | renders both inline | all three                    |
| WhatsApp | yes                         | yes                 | yes (max 30 items per share) |
| Telegram | yes                         | yes                 | yes                          |
| Signal   | yes                         | yes                 | yes                          |

A 3-item payload: short clip (Part 1) + scripture card image + text caption with URL mimics a "curated pack" in the thread.

**Conversion potential: 3/5**
Creates a richer in-thread experience than a single video. The image stays visible in the thread after the video plays. The URL in the text is tappable. Functions as a mini-media-kit in the message thread.

---

## Creative Plays — Ranked by Feasibility × Conversion Potential

The following 10 concepts are ranked. Score = (feasibility 1–5) × (conversion potential 1–5). Max = 25.

---

### Rank 1 — "The Baseline Teaser" — Score 25

**Concept:** 25–30s vertical MP4, H.264, 9:16, silent-captioned in large white text, showing a Jesus Film scene (healing, resurrection, or Sermon on the Mount) with burned scripture overlay. Final 7s: end-card with `jesusfilm.org` URL in large text + dynamic QR code pointing to web Experience slug with UTM.

**In-bubble experience:** Autoplays muted in thread with captions visible. Recipient watches without unmuting. End-card QR and URL are clearly readable.

**Authoring pipeline:**

1. Select scene from Jesus Film library → trim to 20–22s hero moment
2. Whisper AI transcription → .ass subtitle file → FFmpeg subtitle burn
3. `qrencode` for QR → FFmpeg overlay at timecode 22–30s
4. Output: 1080×1920, libx264 main profile, ~8 MB

**Platforms:** All (iMessage, WhatsApp, Telegram, Signal, RCS)

**Funnel:** Passive watch → URL/QR tap → web Experience → app download CTA

**Effort:** 1–2 days prototype; scalable to a template pipeline

---

### Rank 2 — "The Telegram Experience Room" — Score 20

**Concept:** A Telegram bot link (`t.me/JesusFilmBot/Experience?startapp=life-of-jesus`) that opens the JFP Next.js web Experience full-screen inside Telegram's Mini App frame. The full SDUI Experience — hero video, scripture quotes, quiz buttons, video carousels — loads in-chat. Bot sends the link with an inline "Open Experience" button.

**In-bubble experience:** Recipient sees a Telegram message with an "Open Experience" button. One tap → the full JFP web Experience renders in Telegram's browser frame. No install needed.

**Authoring pipeline:**

1. Register bot via @BotFather, configure Mini App URL to `https://jesusfilm.org/experience/[slug]`
2. Add Telegram Web App SDK script tag to the Experience page; call `WebApp.ready()` + `WebApp.expand()`
3. Bot sends message with inline `web_app` button when user shares the experience link

**Platforms:** Telegram only

**Funnel:** Bot link in chat → one-tap open → full SDUI Experience → app download or web bookmark

**Effort:** 3–5 days (SDK integration + bot setup); low if the web Experience already renders responsively on mobile

---

### Rank 3 — "The Cinemagraph Teaser" — Score 20

**Concept:** A 6–8s looping MP4 where 90% of the frame is still (a cinematic Jesus Film still) and one region animates (flowing water, rustling cloth, flickering torch). Scripture text overlaid as if it's part of the still. Loops indefinitely in the thread.

**In-bubble experience:** Recipient perceives an unusually beautiful "photo" that is subtly alive. The motion catches the eye during scroll. "Photo" framing is less threatening than "video" for some audiences.

**Authoring pipeline:**

1. Source a tripod-shot clip with a natural loop point
2. `github.com/yrevar/semi_automated_cinemagraph` → mask selection → MP4 output
3. Add scripture text with FFmpeg `drawtext`
4. Output: 1080×1920, 6s loop, ~3–5 MB

**Platforms:** All (MP4 delivery)

**Funnel:** Thread autoloop creates passive ambient presence → recipient taps for audio → "tap to see more" CTA at loop end

**Effort:** 2–3 days prototype

---

### Rank 4 — "The Scripture Audio Slideshow" — Score 16

**Concept:** A 60–90s "video" that is actually a still scripture card image + narrated audio made into a video file via FFmpeg still-image encode. Narration: a voice actor reading John 3:16 (or a key passage) with ambient music. Image: high-quality photographic scripture card.

**In-bubble experience:** Appears as a video thumbnail. Recipient taps → audio plays; the still image fills the screen. Contemplative, personal register.

**Authoring pipeline:**
`ffmpeg -loop 1 -i scripture_card.jpg -i narration.m4a -c:v libx264 -tune stillimage -c:a aac -b:a 96k -shortest output.mp4`

**Platforms:** All

**Funnel:** Audio plays → scripture heard → tap-through link in companion text bubble

**Effort:** 1 day; replicable for each passage

---

### Rank 5 — "The WhatsApp Sticker Pack" — Score 12

**Concept:** A pack of 10–15 animated WebP stickers featuring: scripture quote cards (e.g., "For God so loved the world" with illustrated art), moments from the Jesus Film (illustrated, not photographic), and contemplative symbols (cross, dove, open hands). Distributed via a sticker pack app listed in WhatsApp.

**In-bubble experience:** Users place stickers in conversations. Each sticker is 512×512 animated WebP, loops, appears inline. A branded sticker becomes a repeated micro-impression across the WhatsApp network.

**Authoring pipeline:**

1. Commission illustrated assets (avoid photographic copyright issues)
2. Animate in After Effects or Rive → export frames → `gif2webp` → animated WebP at ≤500 KB/sticker
3. Package as WhatsApp sticker app (React Native or Swift wrapper of WhatsApp Stickers SDK)

**Platforms:** WhatsApp only

**Funnel:** Sticker use → brand recall → JFP URL embedded in sticker pack app description → install

**Effort:** 1–2 weeks (art + sticker app)

---

### Rank 6 — "The Three-Clip Thread Feed" — Score 12

**Concept:** A 3-item share payload from the JFP mobile app: (1) a 15s "hook" clip (Jesus Film moment), (2) a scripture card image, (3) a text string "Watch the full story → [URL]". Sent as three consecutive items via the iOS share sheet → appears as three bubbles in the thread, simulating a curated media packet.

**In-bubble experience:** Thread shows: video bubble (autoloops) → image bubble (scripture card remains visible) → text bubble with tappable URL.

**Authoring pipeline:**
In the JFP Expo app: `Share` button triggers `expo-sharing` with the three items. The app assembles the payload (pre-rendered video clip, scripture card image, text URL).

**Platforms:** iMessage, WhatsApp, Telegram, Signal (all accept 3-item share payloads)

**Funnel:** Video watch → image seen → URL tap → web Experience

**Effort:** 3–5 days (share sheet integration in Expo app)

---

### Rank 7 — "The Telegram Channel Clip Series" — Score 12

**Concept:** A public Telegram channel for JFP content. Each post: one MP4 clip (30–60s) + scripture caption + link button. Users share individual posts from the channel into private chats. The share is a Telegram-native forward — renders the full post with video, caption, and channel attribution.

**In-bubble experience:** Forwarded channel post shows inline video, caption text, and "via @JesusFilmChannel" attribution. Recipient can tap the channel link.

**Authoring pipeline:** Standard MP4 production pipeline; post scheduling via Telegram bot API or manual posts.

**Platforms:** Telegram only

**Effort:** Ongoing content operations; technical setup 1 day

---

### Rank 8 — "The iMessage Sticker Pack" — Score 9

**Concept:** An iMessage sticker pack (MessagesExtension) with animated APNG stickers: scripture quotes, illustrative moments from JFP content, contemplative imagery. Users who install the pack place stickers in iMessage conversations, creating ambient JFP presence in threads.

**In-bubble experience:** Peeled sticker overlaid on a message bubble in iMessage. Recipients see it as a semi-transparent sticker floating over the conversation.

**Authoring pipeline:** Xcode MessagesExtension; APNG sticker assets at 618×618; App Store submission.

**Platforms:** iMessage only

**Effort:** 1–2 weeks (art + Xcode project + App Store review)

---

### Rank 9 — "The RCS Carousel" (Android Priority Markets) — Score 9

**Concept:** An RCS Business Messaging Rich Card Carousel: 5 cards, each with a Jesus Film scene image, 2-line caption, and "Watch" / "Share" action buttons. Sent to users who have opted into a JFP devotional number (via SMS keyword "JESUS" → RCS upgrade).

**In-bubble experience:** Horizontal scrollable carousel in Google Messages. Each card shows scene image, title, scripture excerpt, and two buttons. Fully interactive, no install.

**Authoring pipeline:** Register JFP as an RCS Business agent via Sinch/Twilio; build carousel payload via RCS Business Messaging API.

**Platforms:** Google Messages (Android)

**Effort:** 2–3 weeks (business registration + API integration)

---

### Rank 10 — "The Live Photo Cinemagraph" (iPhone Premium) — Score 6

**Concept:** For iOS app users who are sending to iPhone recipients: generate a Live Photo on-device — a stunning Jesus Film still where only one region (water, fire, a garment) animates. Share as Live Photo from the JFP app → appears as a still in iMessage → recipient long-presses → the image comes alive.

**In-bubble experience:** Still image in thread. Recipient discovers it's "alive" on long-press. The moment of discovery is the conversion hook — "what IS this? How do I see more?"

**Authoring pipeline:**

1. JFP app records a Live Photo-style pair (HEIC + MOV) using the iOS Camera or AVFoundation pipeline
2. Or: generate the cinemagraph MOV on-server; transmit to iOS app; use `PHAssetCreationRequest` with `.pairedVideo` to write it to photo library; user shares from Photos as Live Photo
3. macOS build step (for pre-production): `makelive image.heic loop.mov` (RhetTbull/makelive) to generate the linked pair

**Platforms:** iMessage (iPhone-to-iPhone only)

**Effort:** 1–2 weeks (iOS in-app generation pipeline or macOS pre-production tool)

---

## Citations

Primary technical sources used in this document:

- [Telegram Mini Apps — Bot Web Apps](https://core.telegram.org/bots/webapps) — Official Telegram Mini App developer documentation, sharing mechanisms, bot integration
- [Telegram Sticker Specifications](https://core.telegram.org/stickers) — TGS, WEBM video sticker, static sticker specs
- [RCS Rich Cards — Google for Developers](https://developers.google.com/business-communications/rcs-business-messaging/guides/learn/rich-cards) — Rich card carousel specs, file limits, action buttons
- [RCS Universal Profile 4.0 — GSMA](https://www.gsma.com/solutions-and-impact/technologies/networks/gsma_resources/rich-communication-service-rcs-february-2026-publications/) — Streaming video in Rich Cards, UP 4.0 features
- [MSMessage — Apple Developer Documentation](https://developer.apple.com/documentation/messages/msmessage) — iMessage extension message model
- [A Deep Dive Into iOS Messages Extensions — TwoCentStudios](https://twocentstudios.com/2016/06/24/a-deep-dive-into-ios-messages-extensions/) — Fallback behavior for cold recipients, URL interoperability
- [makelive — RhetTbull/makelive (GitHub)](https://github.com/RhetTbull/makelive) — macOS CLI for Live Photo pair generation, metadata writing
- [Save Live Photos from MOV + JPEG — Medium](https://medium.com/@f_yuki/save-live-photos-from-mov-jpeg-on-ios-app-ff8c4f9045f1) — PHAssetCreationRequest pairedVideo resource type, iOS-side Live Photo generation
- [WhatsApp Stickers — WhatsApp/stickers (GitHub)](https://github.com/WhatsApp/stickers) — Animated sticker WebP spec, 500 KB / 10s / 512×512 limits
- [WhatsApp Media Message Specs — Developers.cm.com](https://developers.cm.com/messaging/docs/whatsapp-media-message) — Supported media types, file size limits
- [Animated Images in 2025 — WEBP to PNG blog](https://webp-to-png.tools/blog/animated-images-in-2025-webp-vs-apng-vs-gif-real-world-use-cases/) — Cross-platform animated format support matrix
- [Semi-automated Cinemagraph — yrevar (GitHub)](https://github.com/yrevar/semi_automated_cinemagraph) — OpenCV + FFmpeg cinemagraph pipeline
- [Creating App Clip Codes — Apple Developer](https://developer.apple.com/documentation/appclip/creating-app-clip-codes) — App Clip Code generation, SVG output, NFC vs scan-only
- [AMP for Email — Google for Developers](https://developers.google.com/workspace/gmail/ampemail) — Gmail AMP email components, fallback behavior
- [WhatsApp Business Platform Features](https://business.whatsapp.com/products/business-platform-features) — Business API interactive message types
- [QR Codes in 2025 — Origin Media](https://www.corp.originmedia.tv/ctvinsider/qr-codes-in-2025-whats-hot-and-whats-not) — QR scan rate benchmarks in video context
- [FFmpeg Docs](https://ffmpeg.org/ffmpeg-codecs.html) — H.264 profile/level, subtitle filter, overlay filter
