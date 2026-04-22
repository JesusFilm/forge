# JF Forge TV — Install on Your Personal TV

**Status:** ⚠️ Not yet ready for stakeholder use. This doc is drafted ahead of the first build going live. The "Troubleshooting" section will be filled in after the first real install on hardware. Wait for an explicit invite from Urim before following these steps.

---

This guide walks you through installing the JF Forge TV app on your personal **Apple TV** or **Android TV / Google TV** so you can preview new builds as they ship. It takes about 10 minutes once your TV is set up correctly.

## 1. Before you start — device checklist

A few common TV configurations silently block install. Check these first; fixes after install fails are slower than checks before.

### Apple TV

- [ ] Apple TV is **Apple TV HD (4th gen, 2015)** or newer. Older models can't run tvOS 16, which the app requires. Check via **Settings → System → About**.
- [ ] tvOS version is **16.0 or higher**. Update via **Settings → System → Software Updates → Update Software**.
- [ ] The Apple TV is signed into the **same Apple ID** you'll send to Urim. Check via **Settings → Users and Accounts**. If a family member's Apple ID is signed in, either switch users or use that Apple ID for the invite.
- [ ] Your Apple ID is **not a child Apple ID** under Family Sharing. Child Apple IDs need parental approval for every TestFlight install — workable but annoying. Adult Apple ID strongly preferred.
- [ ] Your Apple ID is **not managed by Apple Business Manager / MDM**. Some corporate-issued Apple IDs explicitly disallow TestFlight; if yours is one, use a personal Apple ID instead.
- [ ] **Screen Time / Restrictions** are off, or at least permit "Installing Apps". Check via **Settings → General → Restrictions**.
- [ ] Your Apple ID's **App Store country/region** matches the JFP developer account's distribution region (US). If your Apple ID is set to a different country, the TestFlight invite won't work — you'll need a US-region Apple ID.

### Android TV / Google TV

- [ ] Your TV runs **Android TV** or **Google TV** (not Fire TV, Roku, Tizen on Samsung, or webOS on LG). The Play Store must be present on the home screen. If you have a Fire TV / Roku / smart TV without Play Store, tell Urim — you may need a loaner device.
- [ ] You're signed into the same **Google account** you'll send to Urim. Check via **Settings → Accounts and sign-in**.
- [ ] **Google Play Store** can install apps. Open it and confirm you can browse / install something else (e.g., search for "VLC" — don't install, just confirm the install button is active).

If anything in the checklist fails, message Urim before going further.

## 2. Installing on Apple TV

> Note: The TestFlight invite is sent to your Apple ID's email address. Make sure you have access to that email account on your phone or laptop.

1. **On your iPhone or iPad** (not the Apple TV): install the TestFlight app from the App Store if you don't have it. Open it once and sign in with the same Apple ID that's on your Apple TV.
2. Check your email for the invitation from "TestFlight" (subject line will mention "JF Forge TV"). Tap **View in TestFlight** — this links your account to the testing program.
3. **On your Apple TV**: open the **App Store** app, search for "**TestFlight**", and install it. (Yes, TestFlight is its own separate app on Apple TV.)
4. Open TestFlight on your Apple TV. Sign in with the same Apple ID as in step 1. The "JF Forge TV" app should appear in your available builds list.
5. Select **Install** and wait for the download to finish. Open the app — you should see the JF logo splash, then the home screen.

**If TestFlight on Apple TV doesn't show the invite:** sign out and sign back in. Apple TV's TestFlight app sometimes takes a few minutes to sync after the iPhone-side acceptance.

## 3. Installing on Android TV / Google TV

1. **On your phone or laptop**, open the **opt-in URL** Urim sent you (looks like `https://play.google.com/apps/testing/org.jesusfilm.forgetv`).
2. Sign in with the **same Google account** that's on your Android TV.
3. Click **Become a tester**. You'll see a confirmation message; the link to download the app will appear after a few minutes.
4. **On your Android TV**, open the **Play Store**. Search for "JF Forge TV" — it should appear (if it doesn't, wait 5–10 minutes; Play Store's tester-list refresh has a delay).
5. Install. Open the app. You should see the JF logo splash, then the home screen.

## 4. Confirming which version you're running

When you report a bug or share feedback, include the version string. Here's how to find it:

1. Open the app on your TV.
2. Press and hold the **Menu** button (Apple TV remote) or **Back** button (Android TV remote) for ~2 seconds. The **Expo Dev Menu** appears.
3. Look for the line labelled "Update ID" or "Runtime Version". Copy the short string (e.g., `update-abc123` or `runtime-fp-xyz789`).
4. Press Menu / Back to dismiss the dev menu and return to the app.

Send that string in your bug report so Urim knows exactly which build you're on.

## 5. What updates look like

The TV app updates in two ways, and both happen automatically once you're set up:

- **Native updates** (less frequent — every couple of weeks). On Apple TV, TestFlight will show an "Update Available" prompt the next time you open TestFlight; tap to install. On Android TV, Play Store auto-updates the app overnight; you don't have to do anything.
- **JS / content updates** (more frequent — could be daily during active development). Silent. The next time you open the app, the new version is already there. No prompt, no download bar.

If you notice the app behaving differently than the last time you opened it, that's expected — it's the new version.

## 6. What "stale build" looks like, and what to do

Apple TV's TestFlight expires builds **90 days** after they were uploaded. If Urim hasn't shipped a new native build in that window, your Apple TV will refuse to launch the app with an error like:

> "This beta has expired. Please contact the developer for a new build."

**What to do:** message Urim. He'll ship a new build, and TestFlight will prompt you to install the update within 30 minutes or so.

**Known limitation:** if Urim is unavailable for an extended period (PTO, illness), there's no fallback operator who can ship an emergency build. The app will stay broken until Urim returns. This is a deliberate scope tradeoff for the prototype phase — if your demo timing is critical, message Urim a couple weeks in advance to confirm the build is fresh.

Android TV doesn't have this problem; Play Store auto-updates don't expire.

## 7. Troubleshooting

⚠️ **Pending real-world data.** This section will be populated after the first install on actual stakeholder hardware (Unit 6 of the project plan). If you hit an issue during install and there's no entry below for it, message Urim — your case becomes the next entry.

- _placeholder for "TestFlight invite redemption code on Apple TV remote keyboard is finicky"_
- _placeholder for "Play Store doesn't show app for X minutes after opt-in"_
- _placeholder for whatever else turns up_

## 8. Reporting issues

Slack DM to Urim. Include:

- The version string from section 4
- What you were doing when the issue happened
- A photo of the TV screen if it's visual
- Apple TV model + tvOS version, or Android TV brand + version

Thanks for previewing — your feedback shapes the rollout.
