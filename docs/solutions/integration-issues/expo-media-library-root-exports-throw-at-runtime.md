---
module: apps/mobile
tags:
  [expo, expo-media-library, sdk-upgrade, deprecation, guards, mocked-vs-real]
problem_type: integration_issue
component: raw-file-export
---

# expo-media-library's package root throws at runtime, and a name-grep guard cannot see it

## What happened

`apps/mobile/src/lib/rawExportRuntime.ts` — the composition root for raw file
export — imported the media library the obvious way:

```ts
import * as MediaLibrary from "expo-media-library"
```

Every export would have failed on device. The whole feature was dead, and
**3,341 passing tests, a clean typecheck, a clean lint and a purpose-built
wiring guard all said it was fine.** It was caught by an adversarial code
reviewer reading the installed package, not by anything in the repository.

## The mechanism

Since SDK 54 the package ROOT re-exports `legacyWarnings`
(`build/legacyWarnings.js`), where the legacy functions are stubs whose entire
body is a throw:

```js
export async function saveToLibraryAsync(localUri) {
  throw errorOnLegacyMethodUse("saveToLibraryAsync")
}
```

The package's own doc comment says it plainly: _"This method will throw in
runtime."_ In `expo-media-library@57.0.4` this covers `saveToLibraryAsync`,
`createAssetAsync`, `createAlbumAsync`, `getAlbumAsync`, `getAssetsAsync`,
`deleteAssetsAsync` and eleven more — 18 functions in all.

Two things make it invisible:

- **The typed surface is identical.** The stubs carry the real signatures and
  the real JSDoc, so `tsc` is happy and autocomplete offers them.
- **Only three of the five calls we make are stubbed.**
  `getPermissionsAsync` / `requestPermissionsAsync` are REAL on the root (they
  route to `ExpoMediaLibraryNext`). So permissions work, the transfer runs, the
  file stages — and then the library write throws. It fails at the last step,
  which reads like a permissions or a file problem.

## The fix

Import the `/legacy` subpath, which is in the package's `exports` map and ships
the real implementations:

```ts
import * as MediaLibrary from "expo-media-library/legacy"
```

Take permissions from the same subpath, not just the write calls. The add-only
scope this app relies on lives on the legacy native module's own
`MediaLibraryWriteOnlyPermissionRequester`; splitting the grant and the write
across two native modules is asking for a mismatch.

The alternative is migrating to the new class-based API (`Asset.create()`,
`album.add()`), which is a different piece of work.

## Why the guard missed it — the transferable lesson

`rawExportWiring.guard.test.js` was written for exactly this class of failure.
Its own header says so: _"every module below rawExportRuntime.ts is pure and
injected... ALL of it stays green when the composition root stops wiring the
real bindings."_ It scans the composition root for `saveToLibraryAsync`,
`createAssetAsync`, `createAlbumAsync`.

All three names were present. They were present in the broken version too.

**A wiring guard that greps for call NAMES proves the call is written, never
that the thing it resolves to works.** The name was never the question — the
entry point was, and no amount of text scanning over the call site can see
which module a specifier resolves to.

What actually discriminates:

| Layer              | Check                                                                           | Catches                                      |
| ------------------ | ------------------------------------------------------------------------------- | -------------------------------------------- |
| Runtime capability | `require` the subpath the app imports; assert every call it makes is a function | the module genuinely lacking the call        |
| Upstream premise   | read the installed package and assert the root still ships throwing stubs       | an SDK bump changing the situation under you |
| Wiring             | assert the source names the correct specifier, and NOT the bare root            | the one-character revert                     |

`src/lib/__tests__/mediaLibraryEntryPoint.guard.test.js` does all three.
Falsified by restoring the original import: the new guard fails, and the old
wiring guard stays green — which is the whole point.

## How to notice this class early

- When a package's types and its runtime disagree, only resolving the module
  can tell you. `import * as X` from a package that has `/legacy` and `/next`
  subpaths in its `exports` map is a standing invitation to check which one the
  bare root actually gives you.
- A feature that is fully pure and fully injected has exactly one place where
  it can be silently disconnected from reality. Guard that place at the layer
  where reality lives, not at the layer where the text lives.
- Read the `build/*Warnings.js` or `*Deprecat*` artifact of any Expo package you
  are adopting mid-SDK-cycle. It is a short file and it lists what will throw.

## See also

- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — the META home for this family. This is a worked instance of its central
  claim, with the added twist that the purpose-built guard was itself the
  mocked shape.
- `docs/solutions/build-errors/mmkv-memset-s-xcode-26.md` — the other defect the
  same session's first native build surfaced. Both were invisible to the suite
  and visible immediately on a real build.
