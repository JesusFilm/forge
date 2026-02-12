# Content lifecycle and state machine

States:

- `author_draft`
- `ai_processing`
- `ai_draft_ready`
- `in_review`
- `approved`
- `published`
- `changes_requested`

Transitions:

- `author_draft -> ai_processing`
- `ai_processing -> ai_draft_ready`
- `ai_draft_ready -> in_review`
- `in_review -> approved`
- `approved -> published` (human role required)
- `in_review -> changes_requested`
- `changes_requested -> ai_processing` or `changes_requested -> author_draft`

Invariant: AI actors cannot transition to `published`.
