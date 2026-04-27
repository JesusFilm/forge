# Messaging Bubble Platform Capabilities — R&D Digest

**Research date:** 2026-04-24
**Prepared for:** JesusFilm Project / forge monorepo — `rnd-messaging-bubble` worktree
**Scope:** Cold-recipient in-bubble video feasibility across 19 mainstream messaging platforms
**Goal:** Determine where a cold non-Christian recipient can watch Jesus Film video inside a message bubble without app install; identify escalation paths.

---

## Summary Comparison Table

| Platform                    | Inline Video                                                                  | Autoplay                                                     | 3rd-Party Interactivity                                                             | Cold-Recipient Fit                           | Notes                                                                     |
| --------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| iMessage (personal)         | Yes (MP4, tap-to-play via OG link preview; direct attachment)                 | No (muted inline on link preview; direct video plays inline) | MSMessageExt (App Store required on sender; degrades gracefully on receiver)        | **High** (with OG video link)                | No install required for link preview; extension degrades to static bubble |
| Apple Messages for Business | Yes (video rich link, tap-to-play, muted)                                     | No                                                           | Rich links, list pickers, quick replies, Apple Pay — business only                  | **High** (B2C, not P2P)                      | Requires MSP partnership + Apple approval                                 |
| WhatsApp (personal)         | Yes (MP4 ≤16 MB, inline; heavy recompression)                                 | No (requires tap)                                            | None for 3rd parties; static OG preview only                                        | **Moderate**                                 | OG:video is ignored; static image preview only                            |
| WhatsApp Business Platform  | Yes (video in templates/service msgs, ≤16 MB inline)                          | No                                                           | Buttons (3 max), list pickers (10 options), template messages; NOT person-to-person | **Moderate** (B2C only)                      | Business verification + BSP required; P2P excluded                        |
| Facebook Messenger          | Yes (via media template, bot)                                                 | No                                                           | Generic template, media template, button template, webview — still active (2026)    | **Moderate** (bot/page required)             | Chat Extensions deprecated; webview persists                              |
| Telegram (P2P)              | Yes (MP4 H.264 ≤50 MB bot, 2 GB P2P, inline streaming)                        | No (tap-to-play)                                             | None for P2P; bots can send inline keyboards + inline video                         | **Moderate**                                 | Bot sends inline keyboard + video; no P2P SDK                             |
| Telegram Mini Apps          | Full webview (HLS video possible)                                             | Yes (within webview)                                         | Full interactive app via t.me/bot/app link; opens inside Telegram client            | **High** (best open-web approach)            | Cold recipient needs Telegram installed; no App Store install             |
| Google Messages / RCS       | Yes (P2P: hi-res video ≤100 MB; Business: streaming rich card in UP 4.0)      | No (tap)                                                     | P2P: none for 3rd parties. Business: suggested actions, rich cards, carousels       | **Moderate** (P2P) / **High** (RCS Business) | Apple stuck on UP 2.4; UP 4.0 streaming video is business-only            |
| Signal                      | Yes (video ≤100 MB, inline)                                                   | No                                                           | None — no 3rd-party SDK, no bots, no webview                                        | **Low**                                      | Privacy-first; no developer surface                                       |
| Instagram DMs               | Yes (≤15 sec video in DM)                                                     | No                                                           | Business API (bot-driven): text, images, generic template; NOT for P2P 3rd parties  | **Low** (B2C only)                           | Personal DM: no 3rd-party interactivity                                   |
| Twitter / X DMs             | URL unfurls to link card (static image only)                                  | No                                                           | Player card (in tweets/timeline); DMs: static preview only                          | **Low**                                      | Player card iframe NOT confirmed in DMs                                   |
| Snapchat (Chat/Snap)        | Yes (video in Chat, ≤60 sec / ≤1 GB)                                          | No                                                           | Creative Kit: shares TO Snapchat camera/story, not into DM bubble                   | **Low**                                      | No in-bubble interactive SDK for cold recipients                          |
| Discord (DMs/channels)      | Yes (MP4 inline, ≤10 MB free / ≤100 MB Nitro; URL auto-embeds from YT/TikTok) | Yes (short videos)                                           | Bot embeds (no direct video in custom embed); link-based auto-embed                 | **Low–Moderate**                             | Bots can't embed video in rich embeds directly; links auto-embed          |
| Slack (DMs/channels)        | Yes (video inline ≤1 GB; clip recording ≤5 min)                               | No                                                           | Adaptive Cards (limited in DMs), slash commands, bot messages                       | **Low**                                      | B2B context; cold-recipient scenario uncommon                             |
| Line                        | Yes (video inline); LIFF/LINE Mini App (full webview)                         | No                                                           | LINE Mini App shareable to chat via Share Target Picker                             | **Moderate**                                 | Mini App share to DM: recipient sees link bubble → opens webview          |
| WeChat                      | Yes (≤25 MB inline in P2P chat)                                               | No                                                           | Mini Programs shareable via chat link; opens full webview in-app                    | **High** (China/APAC only)                   | Mini Program link in chat is richest non-app interactive surface          |
| KakaoTalk                   | Yes (≤300 MB)                                                                 | No                                                           | KakaoTalk Channel messages (B2C) have templates; P2P: video only                    | **Moderate** (B2C); Low (P2P)                | Strong in South Korea                                                     |
| Viber                       | Yes (MP4 ≤26 MB, bot-to-user only)                                            | No                                                           | Bot: carousels, buttons, rich media; P2P: video only                                | **Moderate** (bot required)                  | Video from bot plays inline; user cannot send video to bot                |
| Google Chat                 | Yes (video clip ≤unknown, inline)                                             | No                                                           | Adaptive-style Cards v2 (interactive), slash commands; bot in DM works              | **Low** (Workspace context)                  | B2B only; cold recipient is enterprise user                               |
| Microsoft Teams Chat        | Yes (inline via Adaptive Card; OneDrive/SharePoint/YouTube/Vimeo)             | No (poster-based)                                            | Adaptive Cards v1.6 with Media element (YouTube/Vimeo/OneDrive), buttons, forms     | **Low** (enterprise)                         | Arbitrary MP4 URL not confirmed to work; whitelisted sources only         |

---

## Section 1: iMessage (iOS + macOS)

### Inline-Render File Types

**Direct attachment (sent as video file):**
MP4 (H.264), MOV, GIF (animated), HEVC/H.265, HEIC — all render inline in the bubble with a native player. PNG, JPEG render inline as images. APNG renders animated. WebP: static rendering only (no animation). Lottie (.json/.tgs): not supported natively.

**Link preview (OG/LinkPresentation):**
When a URL is pasted, iMessage fetches metadata via `LPMetadataProvider`. If the page provides OG metadata, the preview includes title, image, and optionally a video. The `LPLinkMetadata` object has a `videoProvider` property (type: `NSItemProvider`) that provides the video data for inline playback. This means **any HTTPS URL that serves appropriate OG tags can get inline video playback** — not just a whitelist.

In practice, Apple has built "specializations" for certain link types (YouTube, Apple Maps, Tweets) since iOS 10, but the `videoProvider` property is generally accessible.

Max attachment size for direct video: **~100 MB** enforced by iMessage (MMS fallback to SMS if recipient is non-iMessage is separate).

Sources: [WWDC19 session 262](https://developer.apple.com/videos/play/wwdc2019/262/), [LPLinkMetadata docs](https://developer.apple.com/documentation/linkpresentation/lplinkmetadata)

### Autoplay Behavior

- **Direct video attachment:** Plays inline on arrival, **muted by default**, loops. User taps to unmute or go full-screen.
- **Link preview (OG video):** Does NOT autoplay. Shows poster image with play button overlay. User taps to play, starts muted. YouTube links confirmed to play inline this way (no app departure).
- **iOS vs macOS:** macOS Messages taps the URL fallback mechanism (opens browser for extensions).

### Size & Duration Limits

- **iMessage direct video attachment:** ~100 MB maximum. iOS will suggest compression for large files.
- **MMS fallback (non-iMessage):** 1.2 MB typical carrier limit — completely unsuitable for video.

### Interactive Primitives in the Bubble

**For 3rd-party developers (MSMessagesAppExtension):**

- `MSMessageTemplateLayout`: custom bubble with image + caption (3 lines) + subcaption + trailing caption + URL. Static visual only.
- `MSMessageLiveLayout`: interactive SwiftUI/UIKit view rendered directly in the bubble. Requires recipient to have the same extension installed for the live UI; degrades to `MSMessageTemplateLayout` if not.
- **Sticker packs:** MSSticker — animated or static image, no interactivity.
- **No carousels, no quick replies, no forms, no webviews** for iMessage extensions.

**Tapbacks:** Platform-owned (six emoji reactions) — not controllable by 3rd parties.

### 3rd-Party URL Unfurl Behavior

Paste any HTTPS URL → iMessage fetches OG metadata server-side → renders title + `og:image` + optionally a video from `videoProvider` (populated if `og:video:url` is present and the page supports it).

Respected tags (confirmed via LinkPresentation):

- `og:title` — displayed as card title
- `og:image` — poster/thumbnail
- `og:video:url` / `og:video:secure_url` — feeds `videoProvider` for inline playback
- `og:description` — displayed in some contexts
- `twitter:card`, `twitter:player` — **NOT confirmed** to be read by LinkPresentation; Apple uses OG spec

**Key finding:** Any developer-controlled HTTPS page with correct OG video tags gets inline video playback in iMessage. No application or whitelist is needed for this mechanism. YouTube/Vimeo get privileged treatment only in the sense that Apple has pre-built specializations for their URL patterns — but the generic OG video mechanism is open.

### Domain Whitelisting / Privileged Status

Apple does **not publish a formal whitelist** for LinkPresentation video playback. The WWDC19 session describes specializations for YouTube and Apple Maps but frames the OG video mechanism as universally accessible via `LPMetadataProvider`. No application process is documented for OG video.

**Conclusion:** jesusfilm.org with correct OG tags (`og:video:url`, `og:video:type="video/mp4"`, `og:image`) should get inline video playback in iMessage link previews without any whitelist application.

### Extension/SDK Model

- **MSMessagesAppExtension**: iOS App Extension submitted to App Store. Sender composes an `MSMessage` with an `MSMessageTemplateLayout` + a URL (fallback).
- **Fallback when recipient lacks the extension:** iOS 10+ recipients see the `MSMessageTemplateLayout` (static image bubble) but cannot interact. Pre-iOS 10 recipients see the URL as text. macOS recipients open the URL in a browser.
- **Graceful degradation:** The static template image + fallback URL means the bubble is always readable.
- **No extension install required on the receiving end** to see the static bubble — only the sender needs it to compose.

### Native Share-Sheet Behavior

`UIActivityViewController` with `[NSURL(videoFile), NSString(caption), NSURL(webURL)]`:

- **iMessage activity:** Accepts all three. Video attaches, text becomes the message body. URL may or may not be preserved as a separate link.
- **WhatsApp activity:** Accepts video + caption text; URL is typically dropped.

### 2024–2026 Changes

- **iOS 18 (Sept 2024):** Link preview customization in Messages UI. No functional change to OG video support.
- **iOS 26.4 (beta, Feb 2026):** End-to-end encrypted RCS testing between Apple devices.
- **No new iMessage extension capabilities** announced at WWDC 2024 or 2025 (iMessage extensions remain in maintenance mode).

---

## Section 2: Apple Messages for Business

### Overview

Apple Messages for Business (MfB) is a **Business-to-Consumer (B2C)** channel only. Not person-to-person. Requires: (a) business approval from Apple, (b) a Messaging Service Provider (MSP) integration, (c) going through Apple's registration portal.

### Inline Video + Interactive Primitives

MfB supports:

- **Rich Links:** A URL with a background image or video. Shows a card with image/video thumbnail and URL. Tapping → video plays inline (muted initially). Video formats: `video/mp4`, `video/mpeg`. Images: PNG only (≤200 KB, 240×240 px optimal). YouTube embed URL explicitly supported.
- **Interactive Messages:** List Pickers, Time Pickers, Quick Replies, Forms, Apple Pay buttons — all rendered natively in the iOS Messages bubble.

### SDK Access

Requires Apple MSP partnership. Not available to individual developers directly. Application process at register.apple.com. Monthly fees via MSP.

---

## Section 3: WhatsApp (Personal)

### Inline-Render File Types

- **Video (as media):** MP4 (H.264), 3GPP — render inline in bubble. WhatsApp **recompresses aggressively**: videos are downscaled before sending. **Subtitle legibility: at risk** — burn-in subtitles may become illegible at 360p recompression.
- **Video (as document/file):** Up to 2 GB — sends without inline playback.
- **GIF:** Animated GIF renders inline (looping, no audio).

### Size & Duration Limits

- **Video as media:** 16 MB maximum.
- **Video as document:** 2 GB maximum (no inline playback).
- **Duration:** No documented limit; practical limit ~90 seconds at 16 MB.

### URL Unfurl

WhatsApp reads OG tags (og:title, og:description, og:image, og:url) for link preview cards. **`og:video` and `og:video:url` are explicitly ignored.** Twitter Card tags also ignored. The preview is always static image + title + description. Image max: 1200×630 px, ≤600 KB.

### Interactive Primitives (Personal)

**None beyond reactions.** No buttons, no quick replies, no carousels, no webview, no forms.

### Extension/SDK

No 3rd-party extension model for personal WhatsApp.

---

## Section 4: WhatsApp Business Platform (Cloud API)

### Overview

**B2C only.** Requires Business Verification, a Business Solution Provider (BSP), and approved message templates for outbound (outside 24-hour window). Person-to-person sharing of interactive content is NOT possible through this API.

### Interactive Primitives

- **Reply Buttons:** Up to 3 buttons per message (text-only labels ≤20 chars).
- **List Messages:** Up to 10 options in a picker list.
- **Template Messages:** Video/image header + body + CTA buttons + footer.
- **WhatsApp Flows:** Interactive multi-step forms that open within WhatsApp (native WhatsApp UI, not webview). Available to Business API customers.

### 2024–2026 Changes

October 2025: unverified business portfolios start at 250 messages/24h limit (down from 1,000).

---

## Section 5: Facebook Messenger (Personal)

### Overview

Messenger Platform requires a **Facebook Page** (business account) + app review. Person-to-person 3rd-party interaction is not possible.

### Interactive Primitives (Bot/Page, active as of 2026)

- **Generic Template:** Image + title + subtitle + up to 3 buttons. Can be carouseled (up to 10 cards).
- **Media Template:** Video or image as primary content + 1 button. "These videos and GIFs are playable in the conversation." (Meta docs, 2025)
- **Button Template:** Text + up to 3 buttons.
- **Quick Replies:** Up to 13 predefined reply options.
- **Webview:** Messenger's built-in browser can be opened from a button. Allows full web experience in-app. **Not deprecated as of 2026.**

**What was deprecated:**

- Chat Extensions: **Deprecated** (removed pre-2024).
- Send-to-Messenger website widget: Deprecated Sept 30, 2024.
- Native Messenger desktop apps: Shut down December 15, 2025.

**What remains:** Core Page-to-user messaging (Generic Template, Media Template, Button Template, Quick Replies, Webview) is alive as of April 2026.

---

## Section 6: Telegram (User-to-User P2P)

### Inline-Render File Types

- **Video (sent as video via sendVideo):** MP4 with H.264 + AAC — renders inline with streaming playback. Other formats (HEVC, WebM) send as "Document" with no inline preview.
- **GIF (Animation in Telegram):** Converts GIFs to silent looping MP4 — plays inline, loops.
- **P2P file size:** Up to **2 GB** for regular users. Video plays inline with progressive download/streaming.
- **Bot sendVideo:** MP4 H.264, ≤**50 MB** via standard Bot API.

### Interactive Primitives

**P2P:** None beyond Telegram-native reactions. No 3rd-party interactive bubbles for P2P.
**Bot messages:** Inline keyboards (URL buttons, callback buttons, switch_to_inline, game buttons, pay buttons) — displayed below the message bubble.

### URL Unfurl

Telegram fetches OG metadata: title, description, og:image in a preview card. **No video preview/autoplay from OG tags.**

---

## Section 7: Telegram Mini Apps / Web Apps

### Overview

This is the most powerful open-web interactive mechanism available in any mainstream messaging platform for cold recipients. A Telegram Mini App is a web application (HTML/CSS/JS) hosted on any server, embedded in an iframe within the Telegram client. It requires only that the recipient has Telegram installed — no separate app install.

### Core Mechanics

**Link format:** `https://t.me/BotUsername/AppName?startapp=encodedParam`

This link can be:

- Sent in any Telegram chat (P2P, group, channel)
- Embedded as a button in a bot message
- Shared via the `shareMessage()` API (Bot API 8.0+) which opens a dialog for the user to share a prepared inline message to any chat

**What the cold recipient sees:**

1. They receive the `t.me/BotUsername/AppName` link in chat.
2. They tap it.
3. Telegram opens the Mini App in a **built-in webview** (the Telegram client's own browser — NOT an external browser). Identified as an `<iframe>` within the Telegram native client.
4. No external app install required. The recipient only needs Telegram.
5. The `startapp` parameter is passed to the web app as `tgWebAppStartParam`, allowing content ID deep linking.

**Prior bot interaction required?** For receiving a t.me link in chat, **no prior interaction with the bot is required** on the recipient's side. The link opens the Mini App directly. The user will see a confirmation dialog ("Open [App Name]?") before the webview launches.

**Video playback in Mini App:** Since it is a full HTML5 webview, standard `<video>` element with HLS.js or native HLS works. A JesusFilm experience player with HLS streaming is technically feasible.

**shareMessage flow:**

- Bot creates a `PreparedInlineMessage` via API: `savePreparedInlineMessage`
- Mini App calls `WebApp.shareMessage(msg_id)` → opens Telegram's native share picker
- User selects recipient(s) → message is sent
- Recipients receive the prepared inline message (can include buttons, video link, etc.)

Source: [Telegram Mini Apps core docs](https://core.telegram.org/bots/webapps), [Telegram Bot API](https://core.telegram.org/bots/api)

---

## Section 8: Signal

### Overview

Signal is a privacy-first, end-to-end encrypted messaging app with **no developer API, no bot platform, no SDK for 3rd parties**.

### Inline-Render File Types

- **Video:** MP4, MOV — renders inline. User taps to play.
- **Image, File:** inline for images; file attachment otherwise.

### Size Limits

**100 MB** maximum attachment size for video.

### URL Unfurl

Signal generates a link preview from OG tags. **No video preview.** Static image + title only.

### Extension/SDK

**None.** No bot platform. No Mini App. No message extension framework.

---

## Section 9: Google Messages / RCS

### Inline-Render File Types

**Google Messages (Android, RCS):**

- Video: MP4 — inline playback.
- **Full-resolution photos and videos up to 100 MB** (Google Messages 2026).

**Apple Messages (iOS 18+, RCS via UP 2.4):**

- High-resolution photos and videos supported (same as Android side of RCS).
- Note: iOS stuck on UP 2.4; feature parity with UP 3.0/4.0 not yet on iPhone.

### Interactive Primitives

**Person-to-Person RCS:**

- Typing indicators, read receipts, reactions, high-res media.
- **No 3rd-party interactive bubbles for P2P.**

**RCS Business Messaging (A2P, requires carrier/Google/GSMA BSP relationship):**

- **Rich Cards:** Single or carousel. Image/video, title, description, suggested action buttons.
- **UP 4.0 (ratified March 26, 2026):** Streaming video in Rich Cards (business-only).
- **iOS 18.1+:** RCS for Business available on iPhone for select US carriers (AT&T, T-Mobile, Verizon from Oct 2024).

### 2024–2026 Changes

- iOS 18 (Sept 2024): RCS enabled on iPhone for first time.
- UP 4.0 (March 2026): Native video calls, rich text formatting, streaming video in Business Rich Cards.
- E2EE RCS: Google Messages Android (Apr 2025), Apple testing (Feb 2026, iOS 26.4 beta).
- iPhone RCS penetration: ~70% of US iPhone users on supported carriers by Jan 2026.

---

## Section 10: Instagram DMs

### Overview

Personal Instagram DMs have no 3rd-party developer surface. The Instagram Messaging API is for **Professional accounts** communicating with users who have messaged them first.

### File Types

- **Video in DM (personal):** ≤15 seconds video duration. Inline playback.
- **Image:** JPEG, PNG — inline.

### Interactive Primitives

**Instagram Messaging API (Business/Creator → user, within 24-hour window):**

- Text messages, image attachments, audio.
- Generic Template (image + title + subtitle + buttons — up to 3).
- Quick Replies.
- **No video template confirmed** in Instagram Messaging API.

**P2P:** No developer surface.

---

## Section 11: Twitter / X DMs

### Interactive Primitives in DMs

**DMs (personal):** No interactive primitives for 3rd parties. Text, images, GIFs, links.

### URL Unfurl

DM link preview: static OG card. **Player card (`twitter:card="player"`):** confirmed for tweets/timeline; **In DMs: not confirmed from primary sources.** Player Card requirements target tweets; DM rendering is not documented.

**Conclusion for DMs:** Assume static preview only in DMs.

---

## Section 12: Snapchat (Chat and Snap)

### File Types

- **Chat video:** MP4/MOV ≤60 seconds, ≤1 GB. Renders inline. Disappears after viewing.
- **Stories:** Pre-recorded video up to 5 minutes.

### Extension/SDK — Creative Kit

**Creative Kit** (Snap Kit):

- Shares content (images, videos, stickers) **to Snapchat's camera screen or preview**, not directly into a chat message bubble.
- The recipient flow: content opens in Snapchat's camera/editor → user adds effects → user sends to friend(s)/story.
- **This is NOT in-bubble delivery to a cold recipient.**

**Conclusion:** Snapchat provides no mechanism to deliver interactive content directly into a DM bubble to a cold recipient.

---

## Section 13: Discord (DMs and Channels)

### File Types

- **Video:** MP4 (H.264) — renders inline. WebM also supported.
- **Auto-embed from URLs:** YouTube, Twitch, TikTok, Vimeo URLs auto-embed as playable inline players.
- **Direct MP4 upload:** Plays inline; autoplay for short videos.

### Size Limits

- **Free users:** 10 MB per file.
- **Nitro:** 100 MB.

### Interactive Primitives

**Bots (available in DMs and channels):**

- Rich Embeds: color bar, thumbnail, title, description, fields, footer. **Bots cannot embed video directly in a custom Rich Embed.**
- Buttons, Select Menus (Discord Components). Modals (forms).

---

## Section 14: Slack (DMs and Channels)

### File Types

- **Video clip (native recording):** Up to 5 minutes, renders inline with transcript + CC.
- **Uploaded video file:** Up to 1 GB, renders inline.

### Interactive Primitives (Slack Apps/Bots)

- **Block Kit:** Rich message layout with sections, images, buttons, select menus, date pickers, overflow menus, radio buttons, checkboxes, text inputs.
- **Modals:** Triggered from button clicks.
- **Video in Block Kit:** No video element (images only). Video must be a URL link that auto-unfurls (YouTube/Vimeo).

### Extension/SDK

Slack App: workspace admin approval needed for install. **Not suitable for cold consumer recipients** — Slack is enterprise B2B.

---

## Section 15: Line

### File Types

- **Video:** MP4 — inline playback in chat.
- **Sticker:** Line's native sticker format (.apng, animated).

### Interactive Primitives

**Line Official Account (Business → user):**

- Flex Messages: Rich, flexible card layouts (image, video, text, buttons, carousels) — highly customizable.
- Quick Replies: Up to 13 options.
- LIFF (Line Front-end Framework) → LINE Mini App: Full webview experience. Can be shared to chat via Share Target Picker.

**LIFF / LINE Mini App sharing:**
The Mini App includes a built-in share button → Share Target Picker → share to friends/groups. Recipient sees a rich link bubble. Tapping it opens the Mini App in Line's built-in browser. **Video playback is supported via HTML5 video within the webview.**

---

## Section 16: WeChat (Weixin)

### Overview

WeChat has the most mature in-app Mini Program ecosystem of any messaging platform.

### File Types

- **Video (P2P chat):** MP4 — inline playback. **≤25 MB for inline video** in personal chat.

### Interactive Primitives

**WeChat Mini Programs:**

- Full webview-based applications (uses WeChat's proprietary WXML/WXSS/JS framework).
- Can be shared to individual or group chats as a "Mini Program card".
- Recipient taps → Mini Program opens inside WeChat. No separate install needed (WeChat already installed).
- Video playback supported via `<video>` component.

### Extension/SDK

WeChat Mini Program: requires WeChat Official Account (business registration in China or approved foreign enterprise channel). **Significant barrier: China-centric.**

---

## Section 17: KakaoTalk

### File Types

- **Video:** MP4 — inline playback. ≤**300 MB** maximum for video files in personal chat.

### Interactive Primitives

**KakaoTalk Channel (Official Account, B2C):**

- Basic Template: Thumbnail + title + description + button.
- List Template: Multiple items (up to 3) each with image + title + description + button.
- Wide Image/Carousel: Full-width image cards.
- Buttons: Up to 2 per message.

---

## Section 18: Viber

### File Types

- **Video (bot → user):** MP4, H.264. ≤**26 MB**. Max duration: 180 seconds. Requires `.mp4` extension. Renders inline.
- **Video (user → user):** Standard video in chat; inline playback.

### Interactive Primitives (Viber Bot API)

- **Keyboard (Inline Keyboard):** Buttons rendered below message.
- **Rich Media:** Carousel-style rich media.
- **Structured Messages:** Multiple cards in horizontal scroll.
- **Note:** These are **bot-to-user only**.

---

## Section 19: Google Chat / Microsoft Teams

### Overview

Google Chat and Microsoft Teams are **Workspace (B2B)** products. The "cold non-Christian recipient" scenario is unlikely here.

### Interactive Primitives

- **Google Chat Cards v2:** Full interactive card with images, buttons, date pickers, text inputs. No direct video element.
- **Teams Adaptive Cards v1.6:** Media element supporting YouTube/Vimeo/OneDrive/SharePoint. Arbitrary MP4 URL not confirmed to work — whitelisted sources only.

---

## Platforms Ranked by Cold-Recipient Interactive-Content Feasibility

### Tier 1: High Feasibility (Rich Interactive Experience Possible)

1. **Telegram Mini Apps** — Full HTML5 webview with HLS video, no install beyond Telegram. Share a `t.me/bot/app?startapp=encoded-content-id` link in any chat. Cold recipient taps → confirms → full video Experience inside Telegram. No App Store, no business verification. **Best option for maximum interactivity with cold recipients who have Telegram.**

2. **WeChat Mini Programs** — Equivalent capability to Telegram Mini Apps within WeChat/Weixin. **Best option for APAC/China recipients.** Barrier: Chinese business registration required.

3. **iMessage (personal, via OG link preview)** — Any HTTPS URL with `og:video:url` → inline video playback in iMessage, no install, no application process, no whitelist. Recipients tap the link preview card to play video inline. **Best option for iOS recipients in North America/Europe without Telegram.**

4. **LINE Mini App** — Full webview shareable to chat. Strong in Japan, Taiwan, Thailand.

5. **Apple Messages for Business** — Richest interactive primitives but requires Apple approval + MSP partnership. **Not self-serve.**

### Tier 2: Moderate Feasibility

6. **Google Messages / RCS (P2P)** — High-res video inline (up to 100 MB), but no interactive primitives for cold P2P contact. RCS Business Messaging (streaming rich cards in UP 4.0) is B2C only.

7. **WhatsApp Business Platform** — Video template messages + buttons + list pickers + WhatsApp Flows. But B2C only; Business Verification required.

8. **Facebook Messenger** — Generic Template + Media Template + Webview (all still active 2026). Bot/Page required. Cold contact limited.

9. **Viber** — Bot can send video (≤26 MB, inline) + carousel/keyboard buttons. Strong in Eastern Europe, Middle East.

10. **KakaoTalk** — Template messages with buttons (Channel required, B2C). Strong in South Korea.

### Tier 3: Low Feasibility

11. **LINE (P2P)** — Video inline, but no 3rd-party interactive surface for P2P.
12. **Discord** — Video inline (direct upload or URL embed). Bot Components work in DMs but require prior interaction.
13. **WhatsApp (personal)** — 16 MB inline video, heavy recompression, no interactive primitives, no OG video preview.
14. **Instagram DMs** — 15-second video limit, B2C API only.
15. **Slack** — B2B only.
16. **Google Chat, Microsoft Teams** — B2B enterprise only.
17. **Signal** — No developer surface at all.
18. **Snapchat** — 60-sec video in chat, Creative Kit sends to camera (not DM bubble).
19. **Twitter/X DMs** — Static OG preview only; Player cards not confirmed in DMs.

---

## Research Gaps

1. **iMessage OG video domain behavior:** Whether all HTTPS domains with valid OG video tags reliably get inline video playback in Messages on iOS 18/iOS 19, or whether Apple has undocumented domain allowlisting beyond YouTube. **Testing required on an actual iOS 18 device.**

2. **Twitter/X Player Card in DMs:** The X Developer documentation for Player Cards specifies tweet/timeline behavior. DM behavior is explicitly not documented. Requires direct testing.

3. **WhatsApp og:video handling:** Confirmed from multiple secondary sources that `og:video` is ignored. Not confirmed from Meta's primary developer docs. Testing recommended.

4. **Telegram Mini App cold-recipient bot-interaction requirement:** Confirmed that `t.me/bot/app` links can be opened without prior bot interaction (secondary sources). Testing needed for flows where the recipient has never interacted with the bot.

5. **Discord OG video embed for arbitrary domains:** Whether a jesusfilm.org URL with OG video tags gets a playable embed (rather than static preview). Confirmed it works for YouTube/Vimeo; arbitrary domain behavior unconfirmed.

6. **RCS Rich Card video streaming on iOS 18:** Whether UP 4.0 business rich card features (including streaming video) propagate to Apple Messages on iPhone.

7. **Instagram Messaging API video template:** Whether Instagram (unlike Messenger) supports video in template messages.

8. **Viber person-to-person video size limit:** 26 MB is confirmed for bot-sent video. P2P video limit not found in primary Viber docs.

---

## Sources

- [Apple LPLinkMetadata videoProvider](https://developer.apple.com/documentation/linkpresentation/lplinkmetadata/videoprovider) — accessed 2026-04-24
- [Apple WWDC19 — Embedding and Sharing Visually Rich Links](https://developer.apple.com/videos/play/wwdc2019/262/) — accessed 2026-04-24
- [Apple Messages Developer Docs](https://developer.apple.com/documentation/Messages) — accessed 2026-04-24
- [Apple Messages for Business REST API — RichLink Type](https://register.apple.com/resources/messages/msp-rest-api/type-richlink) — accessed 2026-04-24
- [Apple Developer Forums — MSMessage URL property](https://developer.apple.com/forums/thread/49922) — accessed 2026-04-24
- [twocentstudios — A Deep Dive Into iOS Messages Extensions](https://twocentstudios.com/2016/06/24/a-deep-dive-into-ios-messages-extensions/) — accessed 2026-04-24
- [Telegram Mini Apps — core.telegram.org/bots/webapps](https://core.telegram.org/bots/webapps) — accessed 2026-04-24
- [Telegram Bot API — core.telegram.org/bots/api](https://core.telegram.org/bots/api) — accessed 2026-04-24
- [Meta Messenger Platform Changelog](https://developers.facebook.com/docs/messenger-platform/changelog/) — accessed 2026-04-24
- [Meta Messenger Platform — Send Messages](https://developers.facebook.com/docs/messenger-platform/send-messages/) — accessed 2026-04-24
- [WhatsApp Link Previews — Meta for Developers](https://developers.facebook.com/docs/whatsapp/link-previews/) — accessed 2026-04-24
- [WhatsApp Business API — Template Components](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components/) — accessed 2026-04-24
- [Viber REST Bot API docs](https://developers.viber.com/docs/api/rest-bot-api/) — accessed 2026-04-24
- [Snapchat Creative Kit](https://developers.snap.com/snap-kit/creative-kit/overview) — accessed 2026-04-24
- [LINE Mini App Introduction](https://developers.line.biz/en/docs/line-mini-app/discover/introduction/) — accessed 2026-04-24
- [Microsoft Teams — Media in Adaptive Cards](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/media-elements-in-adaptive-cards) — accessed 2026-04-24
- [GSMA — RCS Universal Profile 4.0 (March 2026)](https://www.gsma.com/newsroom/article/from-rich-text-to-video-rcs-universal-profile-4-0-has-arrived/) — accessed 2026-04-24
- [Sinch — RCS in iOS 18](https://sinch.com/blog/rcs-ios-18/) — accessed 2026-04-24
- [Instagram Messaging API — Meta for Developers](https://developers.facebook.com/docs/instagram-messaging/) — accessed 2026-04-24
- [X / Twitter Player Card Documentation](https://developer.x.com/en/docs/x-for-websites/cards/overview/player-card) — accessed 2026-04-24
- [ogrilla.com — WhatsApp Link Preview Guide (2026)](https://www.ogrilla.com/blog/whatsapp-link-preview-guide) — accessed 2026-04-24
- [Zendesk — Apple Messages for Business full guide 2026](https://www.zendesk.com/service/messaging/apple-messages-for-business/) — accessed 2026-04-24
- [Medium — How to share TMA via direct link in Telegram](https://medium.com/@hushuai2012/how-to-share-tma-app-via-direct-link-in-telegram-ce77bea6483d) — accessed 2026-04-24
- [Google Workspace Updates — Video messages in Google Chat](https://workspaceupdates.googleblog.com/2024/10/send-video-messages-in-google-chat.html) — accessed 2026-04-24
