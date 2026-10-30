# Daily Bible Pause team skills

Claude skills that let a language team run the Daily Bible Pause workflow without the story owner's computer. Upload each `.zip` in claude.ai → Customize → Skills → Upload a skill.

| Skill                        | Who uses it    | What it covers                                                                               |
| ---------------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| `dbp-script`                 | story owner    | the English master script: shape, writing rules, review doc, checklist                       |
| `dbp-language-adaptation`    | language teams | the frozen-meaning rule, review flow, Russian rules                                          |
| `dbp-shorts`                 | everyone       | which Shorts (max 4) and the rules every Short follows                                       |
| `dbp-publishing`             | language teams | YouTube, Facebook, Instagram publishing, titles, credits, rhythm                             |
| `dbp-covers`                 | language teams | YouTube covers in the three series looks from a film frame, no Figma needed                  |
| `dbp-community`              | language teams | the comment round and reply rotation                                                         |
| `daily-bible-pause-captions` | everyone       | captions, titles, descriptions (version 2: current pinned-comment and search rules, Russian) |

The workflow these support: https://claude.ai/artifact/X5gwzzJH5W9eGPMNrnZWPp

Rebuild the zips after editing: `cd team-skills && for d in */; do (cd "$d" && zip -qr "../${d%/}.zip" .); done`
