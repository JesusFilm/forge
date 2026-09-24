# Versification mappings: source and license

The six files in this folder are the standard versification mappings of the
Copenhagen Alliance Versification Working Group.

- Source: <https://github.com/Copenhagen-Alliance/versification-specification>,
  folder `versification-mappings/standard-mappings/`, commit
  `5f3f82f3dc3cfd25fffc6ff04f3630763972258c`, fetched on 2026-09-25.
- License of the data: Creative Commons Attribution-ShareAlike 4.0
  International (CC BY-SA 4.0), <https://creativecommons.org/licenses/by-sa/4.0/>.
  The repository's code is Apache-2.0. This app uses only the data.

## Authors

The upstream README credits these people:

- `org.json`: Neil Rees.
- `eng.json`: Reinier de Blois and Neil Rees.
- `lxx.json`: Reinier de Blois, Neil Rees, Mike Lothers, and Tim Steenwyk.
- `vul.json`: Neil Rees.
- `rsc.json`: Peter Kirk, corrected by Matjaz Crnivec.
- `rso.json`: Peter Kirk, with changes by Matjaz Crnivec and Neil Rees.

## Changes

- Prettier changed the whitespace of each file. The parsed JSON is the same as
  upstream, key order included. We made no other change to these files.
- `../systems.generated.ts` is a derived subset: the 66 books of the reader, in
  a compact form. `../generate-systems.mjs` makes it from these files with
  `buildVersificationSystems` in `../compact.ts`. It is under the same license
  (CC BY-SA 4.0).
- Erratum in the derived `eng` system: `ISA 63:19 => ISA 63:19` and
  `ISA 64:1 => ISA 63:19` are added. `eng.json` has no mapping for eng Isaiah
  64:1, which is the second half of org Isaiah 63:19. `vul.json`, `rsc.json`,
  and `rso.json` have the same two entries. The erratum is in `ENG_ERRATA` in
  `../compact.ts`.
- A derived `bsb` system: `eng` plus two chapter-end joins that BSB makes (3
  John 1:14 holds eng 1:15, and Revelation 12:17 holds eng 12:18). It is in
  `BSB_JOINS` in `../compact.ts`.

## Upstream files

| File       | Upstream bytes | Upstream sha256                                                    |
| ---------- | -------------- | ------------------------------------------------------------------ |
| `org.json` | 21077          | `3b8e065fb592100265ff9ebcea71f5376927fa03c085844f3058d463a2e9cac7` |
| `eng.json` | 27681          | `5162023f8e0604fce96a49d7fb8cea73ef699928846d10d62210bd4882e81338` |
| `lxx.json` | 33991          | `90d980f784512aea00af48646c337b1f7cb97bae3023a9223155369034e466f2` |
| `vul.json` | 33317          | `e09ea002e89aa86cdfbdd4cb69b1ff2c75070801e0648c37aef580d4fc8d06a0` |
| `rsc.json` | 23176          | `c4a8ce2551d4f47bd56cafcf16c5b9169997937e2161e98d1af189a1b85a5d69` |
| `rso.json` | 29816          | `93fbb63369c22022a932acbf562961f1f53998f1edf7140bf4ccb859ad0f3a95` |
