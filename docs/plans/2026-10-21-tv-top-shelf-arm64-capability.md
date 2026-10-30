# Top Shelf ARM64 distribution capability

The observed failure is Apple ITMS-90502 on the ARM64-only Top Shelf extension
in main build 1.0.0 (14). Its containing app declares the correct capability.

1. Add the `arm64` requirement to `apps/tv/top-shelf/Info.plist` so every native
   regeneration carries it into the extension.
2. Exercise the real template through the existing plugin generation test and
   assert the serialized Debug and Release plists declare ARM64.
3. Run focused tests, lint, formatting, TypeScript and clean native prebuild;
   retain the failing-before/fixed-after result.
4. Review and commit the bounded change for the normal PR path. Build a new
   signed device artifact after integration, then validate it with Apple as
   `appletvos` before uploading. Preserve rejected build 14 and its evidence.

No runtime, Android, player, endpoint, recommendation or signing identity change
is needed. Page-loading performance is unaffected because only bundle metadata
and its packaging regression are changed. Full Apple validation and delivery are
separate release steps; do not mark them passed from a simulator or unit test.

## Verification result

- Before fix: the generated Debug plist lacked the capability, reproducing the
  assertion failure; the other 36 plugin cases passed.
- After fix: both focused suites pass (43 tests); TypeScript, changed-test lint
  and formatting pass.
- Clean iOS prebuild emits `arm64` in both Debug and Release extension plists;
  native public-feed and local transport overrides remain off.
- No runtime source, native architecture setting, signature or provisioning
  change was made. The next signed archive still requires Apple server validation.
