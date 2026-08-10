# apps/appletv — native SwiftUI tvOS app

A native Apple-ecosystem client for Jesus Film Watch, parallel to the React
Native TV app (`apps/tv`). Same production backends, native shell:

- **Content**: admin GraphQL (`experienceBySlug("watch-home")`, `watchSearch`) —
  the same public queries `apps/tv` requests, so both clients exercise one
  server contract.
- **Playback**: AVKit `VideoPlayer` over Mux HLS
  (`https://stream.mux.com/{playbackId}.m3u8`).
- **Sign-in**: the feat-322 RFC 8628 device grant against
  `auth.jesusfilm.org` — S256 PKCE (CryptoKit), Keychain token storage,
  CoreImage QR. The standard OAuth endpoints (`/oauth2/token`, `/oauth2/revoke`)
  are **form-encoded only**; the repo's own `/device/*` endpoints speak JSON.
  This split is production-verified — do not "simplify" it.

No external dependencies. No CocoaPods, no SwiftPM packages.

## Build & run

The Xcode project is generated — `project.yml` is the source of truth:

```bash
brew install xcodegen        # once
cd apps/appletv
xcodegen generate            # → JesusFilmTV.xcodeproj (gitignored)
open JesusFilmTV.xcodeproj   # or:
xcodebuild -project JesusFilmTV.xcodeproj -scheme JesusFilmTV \
  -destination 'platform=tvOS Simulator,name=Apple TV 4K (3rd generation)' build
```

Tests: `xcodebuild test` with the same destination, or ⌘U in Xcode.

Adding/removing Swift files needs only `xcodegen generate` again — the spec
globs `Sources/`.

## Status

Prototype: Home (real `watch-home` rails), Search, playback, and device-grant
sign-in. Bundle id `org.jesusfilm.forgetv.native` so it coexists with the RN
app on the same device. Not wired into pnpm/Turbo or CI, and not distributed;
the RN app (`org.jesusfilm.forgewatch`) remains the shipping product.
