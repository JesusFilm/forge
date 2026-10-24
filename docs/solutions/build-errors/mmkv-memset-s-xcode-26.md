---
module: apps/mobile
tags: [ios, cocoapods, mmkv, xcode-26, config-plugin, transitive-dependency]
problem_type: build_error
component: ios-build
---

# MMKV 2.4.1 does not compile under Xcode 26: `use of undeclared identifier 'memset_s'`

## Symptom

Every iOS build of `apps/mobile` fails. No app change causes it and no app change
fixes it:

```
❌  (ios/Pods/MMKVCore/Core/aes/AESCrypt.cpp:83:11)

  81 | #elif defined(__STDC_LIB_EXT1__) || defined(MMKV_APPLE)
  82 |     // C11 Annex K, if the implementation actually provides it.
> 83 |     (void)memset_s(ptr, len, 0, len);
     |           ^ use of undeclared identifier 'memset_s'
```

Measured on Xcode 26.5 (17F42), MMKV / MMKVCore 2.4.1.

## Why it happens

Line 81 is the defect. MMKV takes the C11 Annex K branch whenever `MMKV_APPLE`
is defined — it does NOT require `__STDC_LIB_EXT1__` on Apple, it assumes it.

Apple's libc does ship `memset_s`, but `<string.h>` only DECLARES it when
`__STDC_WANT_LIB_EXT1__` is defined as `1` **before** the header is included.
MMKV never defines it. So the call compiles to a reference to a symbol the
translation unit has never seen.

## Why it is nobody's dependency

MMKV is not in `package.json` and nothing in this app calls it.
`@kesha-antonov/react-native-background-downloader@4.5.5` uses it for persistent
download state on iOS, and its podspec deliberately declines to pin a version:

```ruby
s.dependency 'MMKV', '>= 1.2.0'
```

Its own comment explains the reasoning — it only uses basic key/value APIs, so
it leaves CocoaPods free to resolve a newer MMKV for other pods. The consequence
is that any fresh `pod install` takes whatever is newest, and 2.4.1 is what
broke.

## The fix

`apps/mobile/plugins/withMmkvSecureWipeFix.js` — a config plugin that adds a
`post_install` hook defining the macro for MMKV's two targets only:

```ruby
installer.pods_project.targets.each do |target|
  next unless ['MMKVCore', 'MMKV'].include?(target.name)
  target.build_configurations.each do |cfg|
    defs = cfg.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']
    defs = [defs] if defs.is_a?(String)
    cfg.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = defs + ['__STDC_WANT_LIB_EXT1__=1']
  end
end
```

Register it in `app.json` `plugins`. Three properties are deliberate:

- **Scoped to two targets.** This is a workaround for one pod, not an app-wide
  language-mode change.
- **Define, do not pin.** Pinning MMKV in this app's Podfile would take
  ownership of a version floor that belongs to the background-downloader
  package. The macro survives whatever CocoaPods resolves next.
- **Throws when the anchor is missing.** If the Expo template ever drops its
  `post_install` block, a silent no-op would return a project that cannot
  compile with nothing naming why. Failing prebuild is the better outcome.

## The trap that costs a build cycle

`expo run:ios` **skips prebuild when `ios/` already exists.** Adding the plugin
and re-running it produced a byte-identical failure, which reads exactly like
"the plugin does not work."

Force the regeneration, then verify the macro actually landed before you spend
another 10 minutes compiling:

```bash
npx expo prebuild --platform ios
grep -c "__STDC_WANT_LIB_EXT1__" ios/Podfile                       # expect 1
grep -c "__STDC_WANT_LIB_EXT1__" ios/Pods/Pods.xcodeproj/project.pbxproj  # expect 4
```

The second count is the one that matters: 4 = two targets × two build
configurations. A `1` and a `0` means prebuild ran but `pod install` did not.

## Testing

`addMmkvDefine(podfile)` is exported as a pure string transform, so
`plugins/withMmkvSecureWipeFix.test.js` covers it without a prebuild: the macro
lands, the vendor's `react_native_post_install` call survives beside it, a second
application is a no-op (prebuild re-runs mods over generated output), a template
with no `post_install` throws, and an untouched Podfile carries no marker.

Those tests cannot prove the build succeeds. Nothing in jest can — the failure
lives in a C++ translation unit. The evidence is the build itself:
`0 error(s)` on 2026-09-10 against the same toolchain that produced the error
above.

## See also

- `apps/mobile/CLAUDE.md` "EAS builder toolchain pins" — the other case where an
  Apple toolchain bump broke a transitive dependency of a dependency
  (`sharp` / libvips). Same shape, different layer.
- `docs/solutions/integration-issues/expo-media-library-root-exports-throw-at-runtime.md`
  — the other defect this session's first native build surfaced.
