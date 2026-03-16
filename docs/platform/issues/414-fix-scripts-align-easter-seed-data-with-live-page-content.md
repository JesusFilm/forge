---
artifactType: issue
issueNumber: 414
issueTitle: "fix(scripts): align Easter seed data with live page content"
issueUrl: "https://github.com/JesusFilm/forge/issues/414"
state: "CLOSED"
closedAt: "2026-03-12T02:34:31Z"
labels: []
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #414

## Background

The Easter seed script (`scripts/seed-easter.mjs`) has content differences compared to the live page at https://www.jesusfilm.org/watch/easter.html/english.html. A detailed comparison revealed missing sections, text discrepancies, incorrect block ordering, and stylistic inconsistencies.

## Expected outcome

The seed script produces Strapi data that matches the live Easter page in text content, section structure, block order, and styling.

## Acceptance criteria

- [ ] Fix block order: RelatedQuestions before BibleQuotesCarousel (all 7 video groups)
- [ ] Update text content to match live page (intro paragraphs, descriptions, CTA text)
- [ ] Add 5 missing sections: Bible Film Collection, Mission Statement, Easter Documentary, Easter Events Day by Day, New Believer Course
- [ ] Add missing 4th question to The Story section
- [ ] Fix stylistic issues: "Jesus's" → "Jesus'" throughout
- [ ] Fix CTA wording: "deeper" → "deep"
- [ ] Fix Mary Magdalene Q1 wording
- [ ] Re-run seed and verify content matches live page

## Possible solution(s)

Not provided in source issue.

## References

- Live page: https://www.jesusfilm.org/watch/easter.html/english.html
- Related to #89 (cross-platform watch app)
- Related to #409 (video autoplay fix)
- PR #410 (initial seed script with real HLS URLs)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
