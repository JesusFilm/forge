# apps/cms

Strapi v5 CMS application and schema source of truth.

## Boundary

- Owns canonical content + workflow states.
- AI outputs must land in draft/variant records only.
- Publish transition is human-only and role-gated.
