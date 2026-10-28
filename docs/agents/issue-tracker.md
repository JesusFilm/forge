# Forge issue tracker

For feature implementation, use `docs/roadmap/<lane>/feat-NNN-<slug>.md` as the
canonical local ticket. Format and allowed statuses are defined in root
`CLAUDE.md` under Roadmap. Read the file body and frontmatter; the README index
may lag. Identify tickets by path as well as ID.

Claim work by setting `status: "in-progress"`. Keep `depends_on` and `blocks`
bidirectional. Resolve work through a reviewed PR updating the ticket with
evidence and `status: "complete"`; required production evidence must be observed
before completion. GitHub issues, when explicitly linked, close through the
PR's closing reference. Local feat IDs are not GitHub issue numbers.

Specs live in `docs/plans/`. For the event-history migration, use
`docs/plans/2026-10-28-recommendation-event-storage-spec.md` and parent
`docs/roadmap/content-discovery/feat-897-recommendation-event-storage-migration.md`.
